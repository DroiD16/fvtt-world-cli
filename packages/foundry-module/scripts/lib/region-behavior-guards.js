import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { payloadKeyField } from "./sanitize.js";

const EXECUTABLE_REGION_BEHAVIOR_TYPES = Object.freeze(new Set(["executeScript", "executeMacro"]));

// The dedicated executable family passes the one type a GM may arm through the bridge. Every other
// route — the ordinary behavior handlers and the nested `behaviors[]` array on a region write — keeps
// this empty set, so an executable behavior can enter a world only through a command a human enabled.
const NO_EXECUTABLE_TYPES_ALLOWED = Object.freeze(new Set());

/**
 * @param {unknown} type
 * @param {ReadonlySet<string>} allowedTypes
 * @returns {boolean}
 */
function isRefusedExecutableType(type, allowedTypes) {
  return typeof type === "string" && EXECUTABLE_REGION_BEHAVIOR_TYPES.has(type) && !allowedTypes.has(type);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function suppliedRegionBehaviorTypeName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function executableRegionBehaviorTypeName(value) {
  const name = suppliedRegionBehaviorTypeName(value);
  return name !== null && EXECUTABLE_REGION_BEHAVIOR_TYPES.has(name) ? name : null;
}

const REGION_BEHAVIOR_NAMED_TYPE_KEYS = Object.freeze(["type", "==type"]);

function resolveExistingBehaviorType(region, behaviorId) {
  if (!region || behaviorId == null) {
    return null;
  }
  const collection = region.behaviors;
  if (collection && typeof collection.get === "function") {
    const existing = collection.get(behaviorId);
    if (existing?.type) {
      return existing.type;
    }
  }
  const list =
    collection && typeof collection[Symbol.iterator] === "function"
      ? Array.from(collection)
      : Array.isArray(region.toObject?.().behaviors)
        ? region.toObject().behaviors
        : [];
  for (const entry of list) {
    const data = typeof entry?.toObject === "function" ? entry.toObject() : entry;
    if (data && (data._id === behaviorId || data.id === behaviorId)) {
      return data.type ?? null;
    }
  }
  return null;
}

/** @param {Record<string, any> | null | undefined} payload */
export function assertRegionBehaviorsSuppliedAsArray(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const supplied = Object.keys(payload).filter((key) => payloadKeyField(key) === "behaviors");
  const offending = supplied.filter((key) => !(key === "behaviors" && Array.isArray(payload.behaviors)));
  if (offending.length === 0) {
    return;
  }
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `A region's 'behaviors' may only be supplied as the plain 'behaviors' key carrying an ARRAY of behavior objects (found ${offending
      .map((key) => `"${key}"`)
      .join(
        ", "
      )}): DROP these keys and resend. Foundry's operator and dot-notation spellings are NOT equivalent to it — measured on both supported cores, a dotted 'behaviors.<n>.<field>' APPENDS a brand-new behavior instead of editing the row it appears to address (or is a silent no-op that changes nothing while the command reports success), and '==behaviors' REPLACES the whole collection; both of them also bypass the bridge's behavior guards, so a code-executing type ("executeScript"/"executeMacro") supplied that way would arm a self-firing JavaScript trigger (no arbitrary JavaScript execution from the CLI). On the plain array form each entry's type must be the plain 'type' key carrying a string, and a code-executing one is refused there. To ADD or REPLACE behaviors pass the plain 'behaviors' array (it appends declarative behaviors), to edit ONE behavior in place use scene.region.behavior.update, and to remove one use scene.region.behavior.delete`,
    { field: "behaviors", suppliedKeys: offending }
  );
}

/**
 * @param {unknown} entry
 * @param {number} index
 */
function assertRegionBehaviorEntryTypeShape(entry, index) {
  if (!entry || typeof entry !== "object") {
    return;
  }
  const supplied = /** @type {Record<string, any>} */ (entry);
  const offending = Object.keys(supplied).filter(
    (key) => payloadKeyField(key) === "type" && (key !== "type" || typeof supplied.type !== "string")
  );
  if (offending.length === 0) {
    return;
  }
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `A RegionBehavior entry in a region's 'behaviors' array must spell its type as the plain 'type' key carrying a STRING (entry ${index} supplies ${offending
      .map((key) => `"${key}"`)
      .join(
        ", "
      )}): send 'type' as a plain string and resend. No other spelling or value type does what it looks like — measured on both supported cores, Foundry's '==type' operator key APPENDS a fully ARMED behavior on the update path (and stores a forced-replacement operator OBJECT as the row's type on a v14 create, where every read of this collection promises a string), a dotted 'type.<sub>' either fails validation or silently changes nothing, and a non-string 'type' either fails validation or silently discards the ENTIRE behaviors write while the command reports success. The bridge cannot tell whether such a value names a code-executing type ("executeScript"/"executeMacro"), which it must refuse (no arbitrary JavaScript execution from the CLI), so it refuses the spelling instead of guessing — an array-wrapped type like ["pauseGame"] is refused for that reason as well; drop the wrapper and send the bare string`,
    { field: "behaviors", behaviorIndex: index, suppliedKeys: offending }
  );
}

export function assertRegionBehaviorsAllowed(behaviors, existingRegion = null) {
  if (!Array.isArray(behaviors)) {
    return;
  }
  for (const behavior of behaviors) {
    let suppliedKey = null;
    let type = null;
    for (const key of REGION_BEHAVIOR_NAMED_TYPE_KEYS) {
      const name = suppliedRegionBehaviorTypeName(
        behavior && typeof behavior === "object" ? behavior[key] : undefined
      );
      if (name === null) continue;
      if (type === null || EXECUTABLE_REGION_BEHAVIOR_TYPES.has(name)) {
        suppliedKey = key;
        type = name;
      }
      if (EXECUTABLE_REGION_BEHAVIOR_TYPES.has(name)) break;
    }

    if (type === null && behavior?._id != null && existingRegion) {
      type = suppliedRegionBehaviorTypeName(resolveExistingBehaviorType(existingRegion, behavior._id));
    }
    if (type !== null && EXECUTABLE_REGION_BEHAVIOR_TYPES.has(type)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Region behavior type "${type}" executes code when the region fires and is not allowed through the bridge (no arbitrary JavaScript execution from the CLI); only declarative RegionBehavior types are accepted`,
        { field: "behaviors", ...(suppliedKey === null ? {} : { suppliedKey }), behaviorType: type }
      );
    }
  }
  for (const [index, behavior] of behaviors.entries()) {
    assertRegionBehaviorEntryTypeShape(behavior, index);
  }
}

/** @param {any} behavior */
function storedRegionBehaviorType(behavior) {
  if (!behavior) return null;
  const source =
    behavior._source ?? (typeof behavior.toObject === "function" ? behavior.toObject() : behavior);
  return suppliedRegionBehaviorTypeName(source?.type ?? behavior.type ?? null);
}

/** @param {any} payload */
function suppliedNonPlainRegionBehaviorTypeKeys(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload).filter((key) => key !== "type" && payloadKeyField(key) === "type");
}

/**
 * @param {Record<string, any> | null | undefined} payload
 * @param {Record<string, any>} details
 * @param {ReadonlySet<string>} allowedTypes
 */
function assertSuppliedRegionBehaviorTypeAllowed(payload, details, allowedTypes) {
  for (const key of REGION_BEHAVIOR_NAMED_TYPE_KEYS) {
    const type = executableRegionBehaviorTypeName(
      payload && typeof payload === "object" ? payload[key] : undefined
    );
    if (type !== null && !allowedTypes.has(type)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Region behavior type "${type}" executes code when the region fires and is not allowed through the bridge (no arbitrary JavaScript execution from the CLI); only declarative RegionBehavior types are accepted`,
        { ...details, field: "type", suppliedKey: key, behaviorType: type }
      );
    }
  }
}

/**
 * @param {any} behavior
 * @param {Record<string, any>} details
 * @param {{ verb: string, allowedTypes: ReadonlySet<string>, family: string }} context
 */
function assertRegionBehaviorTargetWritable(behavior, details, { verb, allowedTypes, family }) {
  const type = storedRegionBehaviorType(behavior);
  if (isRefusedExecutableType(type, allowedTypes)) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `RegionBehavior ${details.behaviorId} is a "${type}" behavior, which executes code when the region fires: ${family}.${verb} is refused for it in FULL — including a patch that only sets "disabled" — because the bridge does not author or edit self-arming JavaScript triggers (no arbitrary JavaScript execution from the CLI). Use scene.region.behavior.delete to remove it (that is allowed: it supplies no behavior data and removes the execution), edit it in the Foundry UI, or ${
        verb === "clone" && family === "scene.region.behavior"
          ? "clone it with NO --patch (an unpatched duplicate of a GM-authored behavior is allowed)"
          : "delete it and create a declarative replacement"
      }`,
      { ...details, field: "patch", behaviorType: type }
    );
  }
}

/**
 * @param {Record<string, any> | null | undefined} payload
 * @param {Record<string, any>} details
 * @param {{ verb: string }} context
 */
function assertRegionBehaviorTypeSpellingRejected(payload, details, { verb }) {
  const supplied = suppliedNonPlainRegionBehaviorTypeKeys(payload);
  if (supplied.length === 0) return;
  const found = supplied.map((key) => `"${key}"`).join(", ");
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    verb === "create"
      ? `A RegionBehavior create payload may spell 'type' ONLY as the plain 'type' key (found ${found}): drop the offending key and supply the plain 'type' instead. No other spelling is equivalent to it — measured on both supported cores, Foundry's forced-replacement '==type' beside a valid plain 'type' passes Foundry's own validation and stores something the caller did not ask for (a ForcedReplacement operator OBJECT in 'type' on v14, where scene.region.behavior.get promises a string; the junk '==type' key itself on v13), a forced-deletion '-=type' fails validation outright, and a dotted 'type.<sub>' is silently DROPPED on v13 while v14 fails with a bare TypeError that carries no field name.`
      : `A RegionBehavior's 'type' is create-only on scene.region.behavior.${verb} in EVERY spelling — Foundry's forced-replacement/forced-deletion operator keys and any dotted 'type.<sub>' path included (found ${found}): DROP the key and resend. No spelling of 'type' reaches a stored type change here — measured on both supported cores, these keys raise a plain (unnamed) Foundry error before anything is written, and on the update path the client backend reports that refusal only as a UI notification while resolving the update, so a passed-through key would look like a success that wrote nothing. If you really want a behavior of a DIFFERENT type, author it with scene.region.behavior.create and remove this one with scene.region.behavior.delete.`,
    { ...details, field: "type", suppliedKeys: supplied }
  );
}

/**
 * @param {Record<string, any>} patch
 * @param {Record<string, any>} details
 * @param {{ verb: string }} context
 */
function assertRegionBehaviorTypeImmutable(patch, details, { verb }) {
  if (patch && Object.prototype.hasOwnProperty.call(patch, "type")) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      verb === "clone"
        ? "A RegionBehavior clone cannot change 'type': the copy would carry the SOURCE type's 'system' payload into the new type with nothing reconciling the mismatch. Clone without a 'type' override to duplicate this behavior as-is, or use scene.region.behavior.create to author a new behavior of the desired type (with its own 'system' data)"
        : "A RegionBehavior's 'type' is not accepted on an update patch, even when it restates the type the behavior already holds: DROP the 'type' key and resend. Nothing is lost by dropping it — an unchanged 'type' is an empty diff Foundry ignores (measured on both installs), so it can never have been what you were changing; scene.region.behavior.get emits the field, so a get/edit/update round-trip carries it harmlessly. Only an ACTUAL type change is impossible: Foundry permits one only when the 'system' field is force-replaced, and on the update path it reports the resulting validation failure as a UI notification while resolving the update without writing. If you really want a behavior of a DIFFERENT type, author it with scene.region.behavior.create and remove this one with scene.region.behavior.delete",
      { ...details, field: "type" }
    );
  }
}

/**
 * @param {object} args
 * @param {"create" | "update" | "clone"} args.verb
 * @param {Record<string, any>} [args.payload]
 * @param {any} [args.behavior]
 * @param {Record<string, any>} args.details
 * @param {ReadonlySet<string>} [args.allowedTypes]
 * @param {boolean} [args.allowTypeChange]
 */
export function assertRegionBehaviorWriteAllowed({
  verb,
  payload,
  behavior = null,
  details,
  allowedTypes = NO_EXECUTABLE_TYPES_ALLOWED,
  allowTypeChange = false
}) {
  assertSuppliedRegionBehaviorTypeAllowed(payload, details, allowedTypes);

  // The executable family may edit the one executable type it allows, so it must always look at what it
  // is aimed at: an unpatched clone there would otherwise duplicate a stored executeScript behavior.
  const executableFamily = allowedTypes.size > 0;
  if (verb === "update" || (verb === "clone" && (payload != null || executableFamily))) {
    assertRegionBehaviorTargetWritable(behavior, details, {
      verb,
      allowedTypes,
      family: executableFamily ? "scene.region.behavior.executable" : "scene.region.behavior"
    });
  }

  assertRegionBehaviorTypeSpellingRejected(payload, details, { verb });

  if ((verb === "update" && !allowTypeChange) || verb === "clone") {
    assertRegionBehaviorTypeImmutable(payload ?? {}, details, { verb });
  }
}

/**
 * Every spelling of a behavior's `system.<field>` this module accepts. The approval window reads the
 * same set, so a GM is shown the value the guard and Foundry will act on. Any operator spelling, a
 * `system` path deeper than one field, a payload that mixes the plain object with dotted keys, and a
 * read field whose value type the window cannot render are all refused before this reader is
 * consulted, so no unread or under-rendered spelling can carry a value past the guard or the window.
 * @param {Record<string, any> | null | undefined} payload
 * @param {string} field
 * @returns {{ supplied: boolean, value: unknown }}
 */
export function suppliedExecutableBehaviorField(payload, field) {
  if (!payload || typeof payload !== "object") {
    return { supplied: false, value: undefined };
  }

  if (Object.hasOwn(payload, `system.${field}`)) {
    return { supplied: true, value: payload[`system.${field}`] };
  }

  const system = payload.system;
  if (system && typeof system === "object" && Object.hasOwn(system, field)) {
    return { supplied: true, value: /** @type {any} */ (system)[field] };
  }

  return { supplied: false, value: undefined };
}

/**
 * @param {string} segment
 * @returns {boolean}
 */
function isOperatorSegment(segment) {
  return segment.startsWith("==") || segment.startsWith("-=");
}

/**
 * @param {Record<string, any>} payload
 * @param {string[]} supplied
 * @returns {string[]}
 */
function operatorSpelledSystemKeys(payload, supplied) {
  const offending = supplied.filter((key) => key.split(".").some(isOperatorSegment));
  const system = payload.system;
  if (system && typeof system === "object") {
    offending.push(
      ...Object.keys(system)
        .filter(isOperatorSegment)
        .map((key) => `system.${key}`)
    );
  }
  return offending;
}

/**
 * @param {Record<string, any> | null | undefined} payload
 * @param {Record<string, any>} details
 * @param {{ allowDottedSystem?: boolean }} [options]
 */
function assertExecutableBehaviorSystemSpelling(payload, details, { allowDottedSystem = true } = {}) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const supplied = Object.keys(payload).filter((key) => payloadKeyField(key) === "system");
  const operators = operatorSpelledSystemKeys(payload, supplied);
  if (operators.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `A RegionBehavior's 'system' may reach scene.region.behavior.executable.* ONLY as the plain 'system' object or a dotted 'system.<field>' path, with no forced-replacement ('==') or forced-deletion ('-=') operator anywhere in the path or among the object's own keys (found ${operators
        .map((key) => `"${key}"`)
        .join(
          ", "
        )}): drop the offending key and resend a plain spelling. An operator key is not equivalent to the plain one — Foundry resolves it against whatever plain spelling sits beside it in key-insertion order, so the value that ends up stored depends on the order of the payload's keys. This family reads 'system.uuid' to check that an executeMacro behavior names a macro in THIS world, and the GM approval window shows that same read, so an unresolvable spelling could arm a macro that neither the check nor the approving GM ever saw — or blank the uuid of an already armed behavior. Nothing was written`,
      { ...details, field: "system", suppliedKeys: operators }
    );
  }

  const dotted = supplied.filter((key) => key !== "system");
  if (!allowDottedSystem && dotted.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `A RegionBehavior's 'system' may reach scene.region.behavior.executable.create ONLY as the plain 'system' object, not as a dotted 'system.<field>' path (found ${dotted
        .map((key) => `"${key}"`)
        .join(
          ", "
        )}): supply a plain 'system' object and resend. Foundry expands a dotted create key only in its client backend, which the preview does not reach, so a dry run would show this create UNARMED while the real create arms it — the two must not disagree on a policy-gated arming command. Nothing was written`,
      { ...details, field: "system", suppliedKeys: dotted }
    );
  }

  const tooDeep = dotted.filter((key) => key.split(".").length > 2);
  if (tooDeep.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `A RegionBehavior's 'system' may reach scene.region.behavior.executable.* only as the plain 'system' object or a single-field 'system.<field>' path, never a deeper 'system.<field>.<sub>' path (found ${tooDeep
        .map((key) => `"${key}"`)
        .join(
          ", "
        )}): drop the trailing segment and set the whole '<field>' value instead. A deeper path can reshape a field the guard and the GM approval window read — a 'system.events.<n>' key changes WHEN the armed macro fires while the window still shows the stored trigger set — so the value written would differ from the one shown. Nothing was written`,
      { ...details, field: "system", suppliedKeys: tooDeep }
    );
  }

  if (supplied.includes("system") && dotted.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `A RegionBehavior's 'system' may be supplied to scene.region.behavior.executable.* EITHER as the plain 'system' object OR as dotted 'system.<field>' paths, not both (found ${supplied
        .map((key) => `"${key}"`)
        .join(
          ", "
        )}): pick ONE spelling and resend. Foundry resolves the two against each other in key-insertion order, so when both name the same field the stored value depends on the order of the payload's keys, while this family's macro check and the GM approval window can only report one of them. Nothing was written`,
      { ...details, field: "system", suppliedKeys: supplied }
    );
  }
}

/**
 * @param {Record<string, any> | null | undefined} payload
 * @returns {{ supplied: boolean, uuid: unknown }}
 */
function suppliedExecutableMacroUuid(payload) {
  const { supplied, value } = suppliedExecutableBehaviorField(payload, "uuid");
  return { supplied, uuid: value };
}

/**
 * The GM approval window renders each read field with a type it understands: 'events' as a joined
 * list, 'everyone' as a yes/no. A supplied value of any other type would be under-rendered while
 * Foundry still coerced and stored it, so a value the window cannot faithfully show is refused here.
 * @param {Record<string, any> | null | undefined} payload
 * @param {Record<string, any>} details
 */
function assertExecutableBehaviorReadableValues(payload, details) {
  const events = suppliedExecutableBehaviorField(payload, "events");
  if (events.supplied && !Array.isArray(events.value)) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "An executeMacro region behavior's 'system.events' is the list of region events that fire the macro, so it " +
        "must be supplied as an ARRAY of event names. A non-array value would be coerced by Foundry into a trigger " +
        "set the GM approval window cannot show. Supply system.events as an array. Nothing was written",
      { ...details, field: "system.events" }
    );
  }

  const everyone = suppliedExecutableBehaviorField(payload, "everyone");
  if (everyone.supplied && typeof everyone.value !== "boolean") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "An executeMacro region behavior's 'system.everyone' decides whether the macro runs on every connected " +
        "client, so it must be supplied as a boolean. A non-boolean value the GM approval window cannot show is " +
        "refused. Supply system.everyone as true or false. Nothing was written",
      { ...details, field: "system.everyone" }
    );
  }
}

/**
 * @param {Record<string, any> | null | undefined} payload
 * @param {Record<string, any>} details
 * @param {{ required: boolean, allowDottedSystem?: boolean }} context
 */
export function assertExecutableBehaviorMacroResolves(
  payload,
  details,
  { required, allowDottedSystem = true }
) {
  assertExecutableBehaviorSystemSpelling(payload, details, { allowDottedSystem });
  assertExecutableBehaviorReadableValues(payload, details);

  const { supplied, uuid } = suppliedExecutableMacroUuid(payload);
  if (!supplied) {
    if (!required) {
      return;
    }

    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "An executeMacro region behavior runs the macro named by its 'system.uuid', so that uuid is required: " +
        "without it the behavior would fire and do nothing. Supply system.uuid as the uuid of a macro in this " +
        "world (Macro.<id>). Nothing was written",
      { ...details, field: "system.uuid" }
    );
  }

  if (typeof uuid !== "string" || uuid.trim() === "") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "An executeMacro region behavior's 'system.uuid' must be the uuid of a macro in this world (Macro.<id>). " +
        "Nothing was written",
      { ...details, field: "system.uuid", uuid }
    );
  }

  const resolve = /** @type {any} */ (globalThis).fromUuidSync;
  if (typeof resolve !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry uuid resolution API (fromUuidSync) is not available; reload the GM client"
    );
  }

  let resolved = null;
  try {
    resolved = resolve(uuid);
  } catch {
    resolved = null;
  }

  const documentName = resolved?.documentName ?? null;
  const pack = resolved?.pack ?? null;
  if (documentName !== "Macro" || pack) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `The executeMacro region behavior's 'system.uuid' (${uuid}) does not name a macro in this world: it resolves ` +
        `to ${documentName === null ? "nothing" : pack ? `a compendium ${documentName}` : `a ${documentName}`}. ` +
        `A behavior pointing at a missing or compendium macro fires and does nothing, and the GM approving it ` +
        `cannot read what it would run. Create the macro in the world first and use its uuid. Nothing was written`,
      { ...details, field: "system.uuid", uuid, resolvedType: documentName, pack: pack ?? null }
    );
  }
}
