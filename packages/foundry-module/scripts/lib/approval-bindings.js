import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

/** @typedef {{ macroId: string | null, found: boolean, type: string | null, command: string | null }} MacroApprovalBinding */

/**
 * @param {unknown} macroId
 * @returns {{ found: boolean, type: string | null, command: string | null }}
 */
function readMacroContent(macroId) {
  const macro =
    typeof macroId === "string" ? /** @type {any} */ (globalThis.game?.macros?.get?.(macroId) ?? null) : null;
  if (macro === null) {
    return { found: false, type: null, command: null };
  }

  return {
    found: true,
    type: typeof macro.type === "string" ? macro.type : null,
    command: typeof macro.command === "string" ? macro.command : null
  };
}

/**
 * @param {MacroApprovalBinding} binding
 * @param {{ found: boolean, type: string | null, command: string | null }} current
 * @returns {string[]}
 */
function macroBindingDrift(binding, current) {
  const drifted = [];
  if (current.found !== binding.found) drifted.push("existence");
  if (current.type !== binding.type) drifted.push("type");
  if (current.command !== binding.command) drifted.push("body");
  return drifted;
}

const BINDING_DEFINITIONS = Object.freeze({
  "macro.execute": {
    /** @param {any} params */
    capture(params) {
      const macroId = typeof params?.macroId === "string" ? params.macroId : null;
      return { macroId, ...readMacroContent(macroId) };
    },

    /**
     * @param {any} params
     * @param {MacroApprovalBinding} binding
     */
    assertFresh(params, binding) {
      const macroId = typeof params?.macroId === "string" ? params.macroId : null;
      const drifted =
        binding.macroId !== macroId ? ["identity"] : macroBindingDrift(binding, readMacroContent(macroId));
      if (drifted.length === 0) {
        return;
      }

      throw createBridgeError(
        ERROR_CODES.APPROVAL_STALE,
        `Macro ${macroId} is no longer the macro the GM approved: its ${drifted.join(", ")} changed between ` +
          `the moment the approval request captured the macro for display and the moment the GM allowed it. ` +
          `An approval covers exactly the content the GM was shown, so the allowed execution was refused and ` +
          `NOTHING was executed. This refusal is terminal for this invocation and is not retried by the bridge: ` +
          `read the macro with macro.get to see what it holds now, then re-send macro.execute to request a ` +
          `fresh approval of the current content`,
        { macroId, drifted }
      );
    }
  }
});

/**
 * @param {string} command
 * @param {unknown} params
 * @returns {unknown}
 */
export function captureApprovalBinding(command, params) {
  const definition = Object.hasOwn(BINDING_DEFINITIONS, command)
    ? BINDING_DEFINITIONS[/** @type {keyof typeof BINDING_DEFINITIONS} */ (command)]
    : null;
  return definition === null ? null : definition.capture(params);
}

/**
 * @param {string} command
 * @param {unknown} params
 * @param {unknown} binding
 */
export function assertApprovalBindingFresh(command, params, binding) {
  const definition = Object.hasOwn(BINDING_DEFINITIONS, command)
    ? BINDING_DEFINITIONS[/** @type {keyof typeof BINDING_DEFINITIONS} */ (command)]
    : null;
  if (definition === null) {
    return;
  }

  if (binding === null || typeof binding !== "object") {
    throw createBridgeError(
      ERROR_CODES.APPROVAL_STALE,
      `Command ${command} was allowed, but the bridge holds no record of the content the GM was shown for ` +
        `this approval, so it cannot prove the decision covers the current state. The allowed execution was ` +
        `refused and NOTHING was executed. Re-send the command to request a fresh approval`,
      { command }
    );
  }

  definition.assertFresh(params, /** @type {any} */ (binding));
}
