import { MODULE_TITLE, PROTOCOL_COMPONENTS } from "../generated/protocol.js";
import { describeProtocolVersion } from "./bridge-status.js";
import { format } from "./i18n.js";

const PROTOCOL_VERSION_SKEW_KEYS = Object.freeze({
  [PROTOCOL_COMPONENTS.MODULE]: "FVTTWORLDCLI.Startup.ProtocolVersionSkewModule",
  [PROTOCOL_COMPONENTS.CLI_DAEMON]: "FVTTWORLDCLI.Startup.ProtocolVersionSkewDaemon",
  [PROTOCOL_COMPONENTS.UNKNOWN]: "FVTTWORLDCLI.Startup.ProtocolVersionSkewUnknown"
});

export function getDaemonUnavailableWarningMessage() {
  return format("FVTTWORLDCLI.Startup.DaemonUnavailable", { module: MODULE_TITLE });
}

export function getRejectedCredentialWarningMessage() {
  return format("FVTTWORLDCLI.Startup.RejectedCredential", { module: MODULE_TITLE });
}

export function getBridgeBusyWarningMessage() {
  return format("FVTTWORLDCLI.Startup.BridgeBusy", { module: MODULE_TITLE });
}

/** @param {{ expectedVersion: string, actualVersion: string, staleComponent: string }} mismatch */
export function getProtocolVersionSkewWarningMessage({ expectedVersion, actualVersion, staleComponent }) {
  return format(PROTOCOL_VERSION_SKEW_KEYS[staleComponent], {
    module: MODULE_TITLE,
    expected: expectedVersion,
    actual: describeProtocolVersion(actualVersion)
  });
}

export function getRejectedHandshakeWarningMessage(reason) {
  // Two whole sentences instead of one plus a suffix: a locale cannot place a parenthetical it
  // never receives, and the reason is daemon text that must not become sentence structure.
  return reason
    ? format("FVTTWORLDCLI.Startup.RejectedHandshakeWithReason", { module: MODULE_TITLE, reason })
    : format("FVTTWORLDCLI.Startup.RejectedHandshake", { module: MODULE_TITLE });
}

export function getNotPairedWarningMessage() {
  return format("FVTTWORLDCLI.Startup.NotPaired", { module: MODULE_TITLE });
}

export function warnBridgeDisabled(log, message, details = {}) {
  const notifications = globalThis.ui?.notifications;
  if (typeof notifications?.warn === "function") {
    notifications.warn(message, { permanent: true });
    return;
  }

  log("warn", message, details);
}
