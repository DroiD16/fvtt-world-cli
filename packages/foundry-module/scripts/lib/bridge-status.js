import { format, localize } from "./i18n.js";

export const DISPLAY_STATE_GLYPHS = Object.freeze({
  connected: "fa-plug-circle-check",
  pending: "fa-plug-circle-exclamation",
  offline: "fa-plug-circle-xmark",
  unpaired: "fa-plug"
});

export const DISPLAY_STATE_NAMES = Object.freeze(Object.keys(DISPLAY_STATE_GLYPHS));
export const DISPLAY_STATE_GLYPH_NAMES = Object.freeze(Object.values(DISPLAY_STATE_GLYPHS));

export const BRIDGE_ACTION_AVAILABILITY = Object.freeze({
  connected: Object.freeze({ connect: false, disconnect: true }),
  pending: Object.freeze({ connect: true, disconnect: true }),
  offline: Object.freeze({ connect: true, disconnect: false }),
  unpaired: Object.freeze({ connect: true, disconnect: false })
});

export const CONNECTION_ACTIONS = Object.freeze({
  connected: "disconnect",
  pending: "disconnect",
  offline: "connect",
  unpaired: null
});

export const CONNECTION_ACTION_GLYPHS = Object.freeze({
  connect: "fa-plug-circle-bolt",
  disconnect: "fa-plug-circle-minus"
});

export const CONNECTION_ACTION_LABELS = Object.freeze({
  connect: "FVTTWORLDCLI.Authorization.Connect",
  disconnect: "FVTTWORLDCLI.Authorization.Disconnect"
});

const DISPLAY_STATE_LABELS = Object.freeze({
  connected: "FVTTWORLDCLI.BridgeStatus.State.connected",
  pending: "FVTTWORLDCLI.BridgeStatus.State.pending",
  offline: "FVTTWORLDCLI.BridgeStatus.State.offline",
  unpaired: "FVTTWORLDCLI.BridgeStatus.State.unpaired"
});

// A raw status equal to its display state's canonical status adds nothing, so it stays unparenthesised.
// The empty string for offline never matches a real status, which is how every offline reason surfaces.
const CANONICAL_RAW_STATUS = Object.freeze({
  connected: "connected",
  pending: "connecting",
  offline: "",
  unpaired: ""
});

const PENDING_STATUSES = Object.freeze(["connecting", "reconnecting"]);

/**
 * @param {Record<string, any> | null} credential
 * @param {Record<string, any> | null | undefined} bridgeStatus
 * @returns {"connected" | "pending" | "offline" | "unpaired"}
 */
export function resolveDisplayState(credential, bridgeStatus) {
  if (!credential) return "unpaired";
  if (!bridgeStatus) return "offline";
  if (bridgeStatus.status === "connected") return bridgeStatus.helloAcknowledged ? "connected" : "pending";
  if (PENDING_STATUSES.includes(bridgeStatus.status)) return "pending";
  return "offline";
}

const RAW_STATUS_DETAILS = Object.freeze({
  stopped: "FVTTWORLDCLI.BridgeStatus.Raw.stopped",
  error: "FVTTWORLDCLI.BridgeStatus.Raw.error",
  disconnected: "FVTTWORLDCLI.BridgeStatus.Raw.disconnected",
  idle: "FVTTWORLDCLI.BridgeStatus.Raw.idle",
  reconnecting: "FVTTWORLDCLI.BridgeStatus.Raw.reconnecting"
});

/**
 * @param {"connected" | "pending" | "offline" | "unpaired"} displayState
 * @param {string | null | undefined} rawStatus
 */
export function describeConnection(displayState, rawStatus) {
  const state = localize(DISPLAY_STATE_LABELS[displayState]);
  if (displayState === "unpaired" || !rawStatus) return state;
  if (rawStatus === CANONICAL_RAW_STATUS[displayState]) return state;
  const detailKey =
    displayState === "pending" && rawStatus === "connected"
      ? "FVTTWORLDCLI.BridgeStatus.AwaitingHandshake"
      : RAW_STATUS_DETAILS[rawStatus];
  return format("FVTTWORLDCLI.BridgeStatus.StateDetail", {
    state,
    detail: detailKey ? localize(detailKey) : rawStatus
  });
}
