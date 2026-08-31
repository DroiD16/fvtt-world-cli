import { BATCH_GET_MAX_IDS, ERROR_CODES, MACRO_EXECUTE_TIMEOUT_DEFAULT_MS } from "../generated/protocol.js";
import { deriveChatCaptureStatus, startAuthoredChatCapture } from "../lib/chat-capture.js";
import { getActorById, getMacroById, getMacrosCollection } from "../lib/game-collections.js";
import { getSceneEmbeddedById } from "../lib/scene-embedded.js";
import { serializeSettingValue } from "../lib/setting-values.js";
import {
  cloneDocument,
  createMacro,
  deleteDocument,
  previewDocumentUpdate,
  previewMacroCreate
} from "../lib/world-docs.js";
import { BridgeError, createBridgeError, toFailureSummary } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeMacro, serializeMacroSummary } from "../lib/serializers.js";

const RESERVED_MACRO_ARGUMENT_NAMES = Object.freeze(["speaker", "actor", "token", "character", "scope"]);

// Foundry splices each argument NAME as source text into `new AsyncFunction(... , ...argNames, body)`
// (client/documents/macro.mjs), so a name that is not a bare identifier becomes executable code. The
// allowlist is load-bearing security, not validation: the daemon accepts raw JSON, so the schema's
// propertyNames pattern is only defense-in-depth.
const MACRO_ARGUMENT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// A bare-identifier name can still be a reserved word Foundry cannot use as a function parameter, so
// the AsyncFunction constructor throws a SyntaxError before the body runs. Refusing them here blames
// the argument instead of misreporting the macro body as invalid. Sloppy-mode reserved words
// (`yield`, `let`, `static`, ...) are legal parameters and are deliberately absent.
const RESERVED_JS_KEYWORD_ARGUMENT_NAMES = Object.freeze(
  new Set([
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with"
  ])
);

/**
 * @param {Record<string, unknown> | undefined} args
 */
function assertMacroArgumentNames(args) {
  for (const name of Object.keys(args ?? {})) {
    if (RESERVED_MACRO_ARGUMENT_NAMES.includes(name)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Macro argument ${name} is one of the names Foundry itself binds in a script macro's scope ` +
          `(${RESERVED_MACRO_ARGUMENT_NAMES.join(", ")}); rename the argument. Nothing was executed`,
        { argument: name, reserved: RESERVED_MACRO_ARGUMENT_NAMES }
      );
    }

    if (RESERVED_JS_KEYWORD_ARGUMENT_NAMES.has(name)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Macro argument ${name} is a reserved JavaScript keyword and cannot be a function parameter name: ` +
          `Foundry compiles a script macro by splicing each argument NAME into the parameter list of the ` +
          `function it builds, and a keyword there makes that function fail to compile. Rename the argument ` +
          `to an ordinary identifier. Nothing was executed`,
        { argument: name }
      );
    }

    if (!MACRO_ARGUMENT_NAME_PATTERN.test(name)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Macro argument ${name} is not a plain JavaScript identifier. Foundry builds a script macro by splicing ` +
          `each argument NAME straight into the source of the function it compiles, so a name carrying anything ` +
          `but letters, digits, "_" or "$" (and not starting with a digit) would become executable code — a ` +
          `numeric name is refused for the same reason. Rename the argument to a bare identifier. Nothing was executed`,
        { argument: name }
      );
    }
  }
}

/**
 * @param {{ actorId?: string, sceneId?: string, tokenId?: string, args?: Record<string, unknown> }} scope
 */
function resolveMacroScope(scope) {
  const requested = scope ?? {};
  if (requested.tokenId && !requested.sceneId) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "scope.tokenId identifies a token inside one scene, so scope.sceneId is required with it. Nothing was executed",
      { tokenId: requested.tokenId }
    );
  }

  assertMacroArgumentNames(requested.args);

  const token = requested.tokenId
    ? getSceneEmbeddedById(
        /** @type {string} */ (requested.sceneId),
        "Token",
        requested.tokenId,
        ERROR_CODES.TOKEN_NOT_FOUND,
        "tokenId"
      ).document
    : null;

  const actor = requested.actorId ? getActorById(requested.actorId) : (token?.actor ?? null);
  const speaker = resolveMacroSpeaker(actor, token);

  return { actor, token, speaker, args: requested.args ?? {} };
}

/**
 * @param {any} actor
 * @param {any} token
 */
function resolveMacroSpeaker(actor, token) {
  const getSpeaker = /** @type {any} */ (globalThis).ChatMessage?.getSpeaker;
  if (typeof getSpeaker !== "function") {
    return null;
  }

  return getSpeaker.call(globalThis.ChatMessage, {
    ...(actor ? { actor } : null),
    ...(token ? { token } : null)
  });
}

/**
 * @param {{ actor: any, token: any, speaker: any, args: Record<string, unknown> }} scope
 */
function buildMacroExecutionScope(scope) {
  return {
    ...scope.args,
    ...(scope.speaker ? { speaker: scope.speaker } : null),
    ...(scope.actor ? { actor: scope.actor } : null),
    // Foundry binds `token` to a placeable in a script macro's scope, so a macro may read canvas-only
    // properties; the TokenDocument is the fallback when the token's scene is not the viewed one.
    ...(scope.token ? { token: scope.token.object ?? scope.token } : null)
  };
}

/**
 * @param {unknown} value
 */
function serializeMacroReturn(value) {
  if (value === undefined) {
    return { returned: null };
  }

  try {
    return { returned: serializeSettingValue(value) };
  } catch (error) {
    return { returned: null, returnedOmitted: toFailureSummary(error) };
  }
}

/**
 * @param {Promise<unknown>} running
 * @param {number} timeoutMs
 * @param {string} macroId
 */
async function awaitMacro(running, timeoutMs, macroId) {
  /** @type {any} */
  let timer = null;
  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          createBridgeError(
            ERROR_CODES.MACRO_TIMEOUT,
            `Macro ${macroId} did not finish within ${timeoutMs} ms. The outcome is INDETERMINATE: the macro was ` +
              `not cancelled and keeps running in the GM client, so it may still complete, and anything it has ` +
              `already changed stays changed. Do not retry blindly — read the documents it touches to find out ` +
              `what landed, and raise timeoutMs only if the macro is legitimately slow`,
            { macroId, timeoutMs, indeterminate: true }
          )
        ),
      timeoutMs
    );
  });

  try {
    return await Promise.race([running, expiry]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/**
 * Foundry compiles a script macro's body OUTSIDE its own try block, so a body that does not parse
 * throws a SyntaxError out of Macro#execute alongside the errors it raises for a bad scope.
 * @param {unknown} error
 * @param {string} macroId
 */
function macroStartFailure(error, macroId) {
  const summary = toFailureSummary(error).message;
  if (/** @type {any} */ (error)?.name !== "SyntaxError") {
    return createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Foundry refused the execution scope for macro ${macroId}; see details.message. Nothing was executed`,
      { macroId, reason: "foundry_validation", message: summary }
    );
  }

  return createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Macro ${macroId} could not be compiled: its body is not valid JavaScript, so Foundry never built the ` +
      `function it would have run; see details.message for the parser's own words. NOTHING was executed and ` +
      `nothing changed. Fix the macro's command with \`macro update\` — the scope this call supplied is not ` +
      `at fault and resending it unchanged will fail the same way`,
    { macroId, reason: "macro_body_syntax", message: summary }
  );
}

/**
 * @param {unknown} error
 * @param {string} macroId
 */
function macroRunFailure(error, macroId) {
  if (error instanceof BridgeError) {
    return error;
  }

  return createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `Macro ${macroId} threw while it ran; see details.message for the error the macro itself raised. Foundry ` +
      `does not swallow this — the macro simply stopped where it threw, so the outcome is PARTIAL: whatever it ` +
      `changed before that point stays changed and whatever came after never happened. Do not retry blindly — ` +
      `read the documents the macro touches to find out what landed, and fix the macro before running it again`,
    { macroId, reason: "macro_threw", indeterminate: true, message: toFailureSummary(error).message }
  );
}

export function createMacroHandlers() {
  return {
    async "macro.list"(params) {
      const macros = filterByName(Array.from(getMacrosCollection()), params.name);
      const { page, total, hasMore } = paginate(macros, params);
      return {
        macros: page.map((macro) => serializeMacroSummary(macro)),
        total,
        hasMore
      };
    },

    async "macro.get"(params) {
      const macro = getMacroById(params.macroId);
      return {
        macro: serializeMacro(macro, { ownership: true })
      };
    },

    async "macro.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `macro.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const macros = ids.map((id) => serializeMacro(getMacroById(id), { ownership: true }));
      return { macros };
    },

    async "macro.create"(params) {
      const data = canonicalizeFilePathFields(params.data, "Macro");
      if (isDryRun(params)) {
        const preview = previewMacroCreate(data);
        return dryRunResponse({ macro: serializeMacro(preview) });
      }

      const macro = await createMacro(data);
      return {
        macro: serializeMacro(macro)
      };
    },

    async "macro.update"(params) {
      const macro = getMacroById(params.macroId);
      const patch = canonicalizeFilePathFields(params.patch, "Macro");
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(macro, patch);
        return dryRunResponse({ macro: serializeMacro(preview) });
      }

      await macro.update(patch, { diff: true, render: true });
      return {
        macro: serializeMacro(macro)
      };
    },

    async "macro.clone"(params) {
      const macro = getMacroById(params.macroId);
      const patch = canonicalizeFilePathFields(params.patch, "Macro");
      const clone = await cloneDocument(macro, patch ?? {}, { dryRun: isDryRun(params) });
      const result = { macro: serializeMacro(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "macro.delete"(params) {
      const macro = getMacroById(params.macroId);
      const id = macro.id ?? params.macroId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      await deleteDocument(macro);
      return {
        id,
        deleted: true
      };
    },

    async "macro.execute"(params) {
      const macro = getMacroById(params.macroId);
      const scope = resolveMacroScope(params.scope);
      const type = macro.type ?? null;
      const command = typeof macro.command === "string" ? macro.command : "";
      const canExecute = macro.canExecute !== false;

      if (typeof macro.execute !== "function") {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          "Foundry macro execution API (Macro#execute) is not available; reload the GM client"
        );
      }

      if (isDryRun(params)) {
        return dryRunResponse({
          macroId: macro.id ?? params.macroId,
          type,
          canExecute,
          commandLength: command.length
        });
      }

      if (!canExecute) {
        throw createBridgeError(
          ERROR_CODES.PERMISSION_DENIED,
          `Macro ${params.macroId} cannot be executed by this GM user: Foundry requires at least LIMITED ownership ` +
            `of the macro, which is ownership and not a role, so holding the GM role is not enough. Grant ownership ` +
            `with \`macro ownership set\`. Nothing was executed`,
          { macroId: params.macroId }
        );
      }

      const timeoutMs = params.timeoutMs ?? MACRO_EXECUTE_TIMEOUT_DEFAULT_MS;
      const capture = startAuthoredChatCapture();
      try {
        let running;
        try {
          running = Promise.resolve(macro.execute(buildMacroExecutionScope(scope)));
        } catch (error) {
          throw macroStartFailure(error, params.macroId);
        }

        // A timeout answers before the macro settles, so the losing promise needs a reader of its own
        // or its later rejection becomes an unhandled one.
        running.catch(() => {});
        let returnedValue;
        try {
          returnedValue = await awaitMacro(running, timeoutMs, params.macroId);
        } catch (error) {
          throw macroRunFailure(error, params.macroId);
        }

        const chatMessageIds = capture.stop();
        return {
          macroId: macro.id ?? params.macroId,
          type,
          ...serializeMacroReturn(returnedValue),
          chatMessageIds,
          chatCapture: deriveChatCaptureStatus({
            requested: true,
            available: capture.available,
            expectedCount: type === "chat" ? 1 : 0,
            ids: chatMessageIds
          })
        };
      } finally {
        capture.stop();
      }
    }
  };
}
