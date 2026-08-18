import {
  CLIENT_LABEL_CHARACTER_PATTERN,
  CLIENT_LABEL_MAX_LENGTH,
  CLIENT_LABEL_PATTERN,
  MESSAGE_TYPES,
  MODULE_ID,
  MODULE_TITLE,
  PROTOCOL_VERSION
} from "./generated/protocol.js";
import {
  CONNECTION_ACTION_GLYPHS,
  CONNECTION_ACTION_LABELS,
  CONNECTION_ACTIONS,
  describeConnection,
  resolveDisplayState
} from "./lib/bridge-status.js";
import { format, localize } from "./lib/i18n.js";
import { publishStatus, withStatusRefresh } from "./lib/status-signal.js";
import { MODULE_SETTING_KEYS, getBridgeSettings } from "./lib/validators.js";

export function credentialKey() {
  return `${globalThis.game?.world?.id ?? ""}:${globalThis.game?.user?.id ?? ""}`;
}

export function getCurrentCredential() {
  return getBridgeSettings().credentials[credentialKey()] ?? null;
}

export async function setCurrentCredential(value) {
  const credentials = { ...getBridgeSettings().credentials };
  if (value) credentials[credentialKey()] = value;
  else delete credentials[credentialKey()];
  await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.CREDENTIALS, credentials);
  publishStatus(globalThis.foundryCliBridge?.getStatus?.() ?? null);
}

export function getClientId() {
  return getBridgeSettings().clientId || null;
}

let clientIdGeneration = null;

async function generateClientId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const clientId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.CLIENT_ID, clientId);
  return getClientId() || clientId;
}

export async function ensureClientId() {
  const existing = getClientId();
  if (existing) return existing;
  // Overlapping first-use callers must share one generation: a second id would be asserted on the
  // wire while the setting kept another, and the hello gate would reject the pairing it just made.
  clientIdGeneration ??= generateClientId();
  try {
    return await clientIdGeneration;
  } finally {
    clientIdGeneration = null;
  }
}

const LABEL_CHARACTER_PATTERN = new RegExp(CLIENT_LABEL_CHARACTER_PATTERN, "u");
const LABEL_PATTERN = new RegExp(CLIENT_LABEL_PATTERN, "u");

function toWireLabel(value) {
  // Normalizing after the filter, not before: stripping an invisible character can bring a base
  // letter and its combining mark together, and only a later pass composes that into NFC.
  const stripped = [...String(value ?? "")]
    .filter((character) => LABEL_CHARACTER_PATTERN.test(character))
    .join("")
    .normalize("NFC")
    .trim();
  const label = [...stripped].slice(0, CLIENT_LABEL_MAX_LENGTH).join("").trimEnd();
  return LABEL_PATTERN.test(label) ? label : "";
}

export function getDefaultClientLabel() {
  // Sanitizing the name before substitution, not the formatted result: the format string's own
  // literal text would otherwise keep an empty name's label wire-valid and hide the fallback.
  const user = toWireLabel(globalThis.game.user?.name ?? "");
  const formatted = user ? format("FVTTWORLDCLI.Authorization.DefaultLabel", { user }) : "";
  return (
    toWireLabel(formatted) ||
    toWireLabel(localize("FVTTWORLDCLI.Authorization.FallbackLabel")) ||
    MODULE_TITLE
  );
}

export function sanitizeClientLabel(value) {
  return toWireLabel(value) || getDefaultClientLabel();
}

export const CLIENT_LABEL_FIELD_SELECTOR = 'input[name="clientLabel"]';

function readEditableClientLabel(root) {
  // An absent field and an emptied one must stay distinguishable: collapsing both to "" makes a
  // re-render refill a field the GM just cleared, and the next keystroke appends to the prefill.
  const input = root?.querySelector(CLIENT_LABEL_FIELD_SELECTOR);
  return input && !input.readOnly ? input.value : null;
}

export async function requestPairing(label) {
  const { daemonUrl } = getBridgeSettings();
  const client = { id: await ensureClientId(), label: sanitizeClientLabel(label) };
  return new Promise((resolve, reject) => {
    const socket = new globalThis.WebSocket(daemonUrl);
    let settled = false;
    let processingResult = false;
    let expiryTimer = null;
    let pairingNotification = null;
    const clearExpiryTimer = () => {
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    };
    const cleanup = (closeSocket) => {
      clearExpiryTimer();
      pairingNotification?.remove?.();
      pairingNotification = null;
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
      if (closeSocket && socket.readyState < 2) socket.close();
    };
    const rejectPairing = (error, closeSocket = true) => {
      if (settled || processingResult) return;
      settled = true;
      cleanup(closeSocket);
      reject(error);
    };
    const resolvePairing = (value) => {
      if (settled) return;
      settled = true;
      cleanup(true);
      resolve(value);
    };
    const handleOpen = () =>
      socket.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.PAIRING_REQUEST,
          identity: {
            moduleId: MODULE_ID,
            moduleVersion: globalThis.game.modules.get(MODULE_ID)?.version ?? "0.0.0",
            world: { id: globalThis.game.world.id, title: globalThis.game.world.title },
            user: {
              id: globalThis.game.user.id,
              name: globalThis.game.user.name,
              isGM: Boolean(globalThis.game.user.isGM)
            },
            client
          }
        })
      );
    const handleMessage = async (event) => {
      if (settled || processingResult) return;
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        rejectPairing(new Error(localize("FVTTWORLDCLI.Errors.PairingInvalidJson")));
        return;
      }
      if (message.type === MESSAGE_TYPES.PAIRING_PENDING) {
        pairingNotification?.remove?.();
        pairingNotification =
          globalThis.ui?.notifications?.info?.(
            format("FVTTWORLDCLI.Notifications.PairingCode", { code: message.code }),
            { permanent: true }
          ) ?? null;
        clearExpiryTimer();
        const expiresAt = Date.parse(message.expiresAt);
        if (!Number.isFinite(expiresAt)) {
          rejectPairing(new Error(localize("FVTTWORLDCLI.Errors.PairingInvalidExpiry")));
          return;
        }
        expiryTimer = setTimeout(
          () => rejectPairing(new Error(localize("FVTTWORLDCLI.Errors.PairingExpired"))),
          Math.max(0, expiresAt - Date.now())
        );
      }
      if (message.type === MESSAGE_TYPES.PAIRING_RESULT) {
        if (!message.ok) {
          rejectPairing(new Error(message.error?.message ?? localize("FVTTWORLDCLI.Errors.PairingRejected")));
          return;
        }
        // Another tab of this browser reads and writes the same client-scoped setting from its own
        // realm, so a first-use generation there can replace the id this request already asserted.
        // Storing the credential anyway would buy a pairing whose hello the daemon gate always
        // rejects, with nothing in the browser explaining why.
        if (getClientId() !== client.id) {
          rejectPairing(
            new Error(
              format("FVTTWORLDCLI.Errors.ClientIdChanged", {
                current: getClientId() || localize("FVTTWORLDCLI.Errors.ClientIdUnset"),
                asserted: client.id
              })
            )
          );
          return;
        }
        processingResult = true;
        clearExpiryTimer();
        const value = {
          pairingId: message.pairingId,
          credential: message.credential,
          label: client.label
        };
        try {
          await setCurrentCredential(value);
          resolvePairing(value);
        } catch (error) {
          processingResult = false;
          rejectPairing(error instanceof Error ? error : new Error(String(error)));
        }
      }
    };
    const handleError = () => rejectPairing(new Error(localize("FVTTWORLDCLI.Errors.DaemonUnavailable")));
    const handleClose = (event) =>
      rejectPairing(
        new Error(
          format("FVTTWORLDCLI.Errors.PairingClosed", {
            code: event.code,
            reason: event.reason || localize("FVTTWORLDCLI.Errors.NoCloseReason")
          })
        ),
        false
      );
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", handleError);
    socket.addEventListener("close", handleClose);
  });
}

const ACTION_FAILURE_KEYS = Object.freeze({
  pair: "FVTTWORLDCLI.Notifications.PairingFailed",
  connect: "FVTTWORLDCLI.Notifications.AuthorizationConnectFailed"
});

export function createAuthorizationApplication({ connect }) {
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  /**
   * @this {{ element?: { querySelector: (selector: string) => any } | null,
   *   render: (options: { force: boolean }) => Promise<unknown> }}
   */
  const handleAction = async function (event, target) {
    event.preventDefault();
    if (!globalThis.game.user?.isGM) return;
    const action = target.dataset.action;
    if (action === "pair" || action === "connect") {
      try {
        const credential =
          action === "pair"
            ? await requestPairing(readEditableClientLabel(this.element))
            : getCurrentCredential();
        await connect(credential);
      } catch (error) {
        globalThis.ui?.notifications?.error?.(
          format(ACTION_FAILURE_KEYS[action], {
            error: error instanceof Error ? error.message : String(error)
          }),
          { permanent: true }
        );
      }
    }
    if (action === "disconnect") globalThis.foundryCliBridge?.stop?.();
    if (action === "unpair") {
      try {
        if (typeof globalThis.foundryCliBridge?.revokePairing !== "function")
          throw new Error(localize("FVTTWORLDCLI.Errors.RevokeUnavailable"));
        await globalThis.foundryCliBridge.revokePairing();
        globalThis.foundryCliBridge.stop?.();
        await setCurrentCredential(null);
        globalThis.ui?.notifications?.info?.(localize("FVTTWORLDCLI.Notifications.PairingRevoked"));
      } catch (error) {
        globalThis.ui?.notifications?.error?.(
          format("FVTTWORLDCLI.Notifications.UnpairFailed", {
            error: error instanceof Error ? error.message : String(error)
          }),
          { permanent: true }
        );
      }
    }
    if (action === "forget") {
      globalThis.ui?.notifications?.warn?.(localize("FVTTWORLDCLI.Notifications.ForgetLocal"), {
        permanent: true
      });
      globalThis.foundryCliBridge?.stop?.();
      await setCurrentCredential(null);
    }
    await this.render({ force: false });
  };

  return class AuthorizationApplication extends withStatusRefresh(HandlebarsApplicationMixin(ApplicationV2)) {
    static DEFAULT_OPTIONS = {
      id: "fvtt-world-cli-authorization",
      window: {
        title: "FVTTWORLDCLI.Authorization.Title",
        contentClasses: ["standard-form"]
      },
      position: { width: 520 },
      actions: {
        pair: handleAction,
        connect: handleAction,
        disconnect: handleAction,
        unpair: handleAction,
        forget: handleAction
      }
    };

    static PARTS = {
      authorization: {
        template: "modules/fvtt-world-cli/templates/authorization.hbs"
      }
    };

    async _prepareContext() {
      const credential = getCurrentCredential();
      const bridgeStatus = globalThis.foundryCliBridge?.getStatus?.() ?? null;
      const displayState = resolveDisplayState(credential, bridgeStatus);
      const connectionAction = CONNECTION_ACTIONS[displayState];
      const isGM = Boolean(globalThis.game.user?.isGM);
      const paired = Boolean(credential);
      const editable = isGM && !paired;
      // A status refresh re-renders the window, and the prior input holds a typed but unsent label
      // that no other state carries; read it back here, while that DOM still exists.
      const draft = readEditableClientLabel(this.element);
      return {
        isGM,
        paired,
        clientLabel: paired ? (credential.label ?? "") : (draft ?? getDefaultClientLabel()),
        clientLabelEditable: editable,
        clientLabelMaxLength: CLIENT_LABEL_MAX_LENGTH,
        clientLabelTooltip: editable
          ? "FVTTWORLDCLI.Authorization.ClientLabelEditable"
          : paired
            ? "FVTTWORLDCLI.Authorization.ClientLabelFixed"
            : "FVTTWORLDCLI.Authorization.ClientLabelGMOnly",
        displayState,
        connectionLabel: describeConnection(displayState, bridgeStatus?.status),
        connectionAction,
        connectionActionGlyph: connectionAction ? CONNECTION_ACTION_GLYPHS[connectionAction] : "",
        connectionActionLabel: connectionAction ? CONNECTION_ACTION_LABELS[connectionAction] : ""
      };
    }
  };
}
