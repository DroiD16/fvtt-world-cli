import {
  cmd,
  deepFreeze,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  paginatedListSchema,
  paginationProperties,
  patchFrom
} from "./shared.js";

const combatDataSchema = {
  type: "object",
  required: [], // every field has a working Foundry initial — `combat.create {}` is legal
  properties: {
    name: { type: "string" }, // v14 only (module-gated); blank:true, initial "" → no minLength
    type: { type: "string", minLength: 1 }, // NOT an enum — `choices` is a runtime function
    system: freeformObjectSchema,
    scene: { type: ["string", "null"], minLength: 1 }, // bare 16-char id; "" would clean to null
    sort: { type: "integer" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

// NO `type` (patch precedent), NO `active`/`round`/`turn` (action verbs),
// NO `combatants`/`groups` (the embedded families).
const combatPatchSchema = patchFrom(combatDataSchema, { omit: ["type"] });

const combatIdSchema = {
  type: "object",
  required: ["combatId"],
  properties: { combatId: { type: "string", minLength: 1 } },
  additionalProperties: false
};

const combatExpectedStateProperties = {
  expectedRound: { type: "integer", minimum: 0 },
  expectedTurn: { type: ["integer", "null"], minimum: 0 }
};

export const COMBAT_TRANSITIONS = deepFreeze(["none", "turn", "round"]);

export const COMBAT_MUTATION_OUTCOMES = deepFreeze(["committed", "unknown", "not-executed"]);

export const COMBAT_ROLL_MODES = deepFreeze(["public", "gm", "blind", "self"]);

export const COMBAT_INITIATIVE_SELECTIONS = deepFreeze(["all", "npc"]);

export const COMBAT_INITIATIVE_MODES = deepFreeze(["ids", ...COMBAT_INITIATIVE_SELECTIONS]);

function combatAdvanceSchema() {
  return {
    type: "object",
    required: ["combatId", "idempotencyKey"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...combatExpectedStateProperties,
      ...dryRunProperty,
      ...idempotencyKeyProperty
    },
    additionalProperties: false
  };
}

function combatActionSchema() {
  return {
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...dryRunProperty,
      ...idempotencyKeyProperty
    },
    additionalProperties: false
  };
}

const combatRollInitiativeSchema = {
  type: "object",
  required: ["combatId", "idempotencyKey"],
  properties: {
    combatId: { type: "string", minLength: 1 },

    combatantIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    select: { type: "string", enum: [...COMBAT_INITIATIVE_SELECTIONS] },

    formula: { type: "string", minLength: 1 },
    rollMode: { type: "string", enum: [...COMBAT_ROLL_MODES] },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};

const combatSetInitiativeSchema = {
  type: "object",
  required: ["combatId", "combatantId", "initiative"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    combatantId: { type: "string", minLength: 1 },
    initiative: { type: ["number", "null"] },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};

const combatantCreateSchema = {
  type: "object",
  required: [], // every field has a working Foundry initial — an EMPTY combatant is legal (executed)
  properties: {
    type: { type: "string", minLength: 1 }, // NOT an enum — `choices` is a runtime function
    system: freeformObjectSchema,

    actorId: { type: ["string", "null"], minLength: 1 },
    tokenId: { type: ["string", "null"], minLength: 1 },
    sceneId: { type: ["string", "null"], minLength: 1 },
    name: { type: "string" }, // faithful + blank-meaningful → deliberately NO minLength
    img: { type: ["string", "null"], minLength: 1 }, // "" silently clears → minLength is the guard

    initiative: { type: ["number", "null"] },
    hidden: { type: "boolean" },
    defeated: { type: "boolean" },
    group: { type: ["string", "null"], minLength: 1 }, // module checks it names a group of THIS combat
    roundJoined: { type: "integer", minimum: 1 }, // v14 only (module-gated); 0/-3/null are clamped
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const combatantPatchSchema = patchFrom(combatantCreateSchema, { omit: ["type", "initiative"] });

const combatantGroupCreateSchema = {
  type: "object",
  required: [], // every field has a working initial — an unnamed empty group is legal (executed)
  properties: {
    type: { type: "string", minLength: 1 },
    system: freeformObjectSchema,
    name: { type: "string" }, // faithful + blank-meaningful → no minLength
    img: { type: ["string", "null"], minLength: 1 }, // same silent blank→null coercion as Combatant

    initiative: { type: ["number", "null"] },
    flags: freeformObjectSchema
    // `ownership` rejected by omission — read-only on combat.group.get, no setter.
  },
  additionalProperties: false
};

const combatantGroupPatchSchema = patchFrom(combatantGroupCreateSchema, { omit: ["type"] });

const combatantIdSchema = {
  type: "object",
  required: ["combatId", "combatantId"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    combatantId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const combatantGroupIdSchema = {
  type: "object",
  required: ["combatId", "groupId"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    groupId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const combatCommands = {
  "combat.list": cmd(paginatedListSchema),
  "combat.get": cmd(combatIdSchema),
  "combat.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: combatDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.update": cmd(
    {
      type: "object",
      required: ["combatId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        patch: combatPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.delete": cmd(
    {
      type: "object",
      required: ["combatId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.start": cmd(combatActionSchema(), { mutation: true }),
  "combat.activate": cmd(combatActionSchema(), { mutation: true }),
  "combat.next-turn": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.previous-turn": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.next-round": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.previous-round": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.reset-initiative": cmd(combatActionSchema(), { mutation: true }),
  "combat.roll-initiative": cmd(combatRollInitiativeSchema, { mutation: true }),
  "combat.set-initiative": cmd(combatSetInitiativeSchema, { mutation: true }),
  "combat.combatant.list": cmd({
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "combat.combatant.get": cmd(combatantIdSchema),
  "combat.combatant.create": cmd(
    {
      type: "object",
      required: ["combatId", "data"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        data: combatantCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.combatant.update": cmd(
    {
      type: "object",
      required: ["combatId", "combatantId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        combatantId: { type: "string", minLength: 1 },
        patch: combatantPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.combatant.delete": cmd(
    {
      type: "object",
      required: ["combatId", "combatantId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        combatantId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.list": cmd({
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "combat.group.get": cmd(combatantGroupIdSchema),
  "combat.group.create": cmd(
    {
      type: "object",
      required: ["combatId", "data"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        data: combatantGroupCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.update": cmd(
    {
      type: "object",
      required: ["combatId", "groupId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        groupId: { type: "string", minLength: 1 },
        patch: combatantGroupPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.delete": cmd(
    {
      type: "object",
      required: ["combatId", "groupId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        groupId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
