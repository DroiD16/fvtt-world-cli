import { MODULE_TITLE } from "../generated/protocol.js";
import { format } from "./i18n.js";

export function getDaemonUnavailableWarningMessage() {
  return format("FVTTWORLDCLI.Startup.DaemonUnavailable", { module: MODULE_TITLE });
}

export function getRejectedCredentialWarningMessage() {
  return format("FVTTWORLDCLI.Startup.RejectedCredential", { module: MODULE_TITLE });
}

export function getBridgeBusyWarningMessage() {
  return format("FVTTWORLDCLI.Startup.BridgeBusy", { module: MODULE_TITLE });
}

export function getProtocolVersionSkewWarningMessage(expectedVersion, actualVersion) {
  return format("FVTTWORLDCLI.Startup.ProtocolVersionSkew", {
    module: MODULE_TITLE,
    expected: expectedVersion,
    actual: actualVersion
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
