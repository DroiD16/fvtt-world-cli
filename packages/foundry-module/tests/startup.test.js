import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getBridgeBusyWarningMessage,
  getDaemonUnavailableWarningMessage,
  getNotPairedWarningMessage,
  getProtocolVersionSkewWarningMessage,
  getRejectedCredentialWarningMessage,
  getRejectedHandshakeWarningMessage,
  warnBridgeDisabled
} from "../scripts/lib/startup.js";
import { createEnglishI18n } from "./helpers/i18n.js";

describe("bridge startup warnings", () => {
  beforeEach(() => {
    globalThis.game = /** @type {any} */ ({ i18n: createEnglishI18n() });
    globalThis.ui = {
      notifications: {
        warn: vi.fn()
      }
    };
  });

  it("shows a single permanent notification and does NOT also duplicate it to the console when notifications are available", () => {
    const log = vi.fn();
    const message = getRejectedCredentialWarningMessage();

    warnBridgeDisabled(log, message, { setting: "credentials" });

    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(message, { permanent: true });

    expect(log).not.toHaveBeenCalled();
  });

  it("falls back to the console logger when Foundry notifications are unavailable", () => {
    globalThis.ui = {};
    const log = vi.fn();
    const message = getRejectedCredentialWarningMessage();

    warnBridgeDisabled(log, message, { setting: "credentials" });

    expect(log).toHaveBeenCalledWith("warn", message, { setting: "credentials" });
  });

  // Every warning names one stop reason and one remedy, and the callers relay whichever builder they
  // reach, so nothing but the English below distinguishes them: a builder pointed at another reason's
  // key would send the GM to re-pair when the fix is to release a busy bridge slot.
  it.each([
    [
      "an unavailable daemon",
      () => getDaemonUnavailableWarningMessage(),
      "World CLI for Foundry VTT stopped: the configured daemon is unavailable. Start the local daemon and reload the client."
    ],
    [
      "a rejected credential",
      () => getRejectedCredentialWarningMessage(),
      "World CLI for Foundry VTT stopped: the pairing credential was rejected. Open Authorization and pair again."
    ],
    [
      "a busy bridge slot",
      () => getBridgeBusyWarningMessage(),
      "World CLI for Foundry VTT stopped: another pairing owns the daemon's active bridge slot. Release that bridge or use bridge release, then choose Connect in Authorization."
    ],
    [
      "a protocol version skew",
      () => getProtocolVersionSkewWarningMessage("1.4", "9.9"),
      "World CLI for Foundry VTT stopped: protocol version mismatch. This client speaks 1.4 but the daemon speaks 9.9. Upgrade the daemon and module to matching versions and reload the client."
    ],
    [
      "a rejected handshake",
      () => getRejectedHandshakeWarningMessage(""),
      "World CLI for Foundry VTT stopped: the daemon rejected the bridge handshake. Fix the daemon configuration and reload the client."
    ],
    [
      "a rejected handshake the daemon explained",
      () => getRejectedHandshakeWarningMessage("Invalid bridge hello"),
      "World CLI for Foundry VTT stopped: the daemon rejected the bridge handshake (Invalid bridge hello). Fix the daemon configuration and reload the client."
    ],
    [
      "a browser that was never paired",
      () => getNotPairedWarningMessage(),
      "World CLI for Foundry VTT is not paired. Open Authorization from the World CLI scene-controls group, or from Configure Settings → Module Settings → Authorization."
    ]
  ])("tells the GM about %s and what to do next", (_reason, build, expected) => {
    expect(build()).toBe(expected);
  });
});
