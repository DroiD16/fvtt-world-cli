import { CARDS_PASS_MAX_IDS } from "../constants.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  cmd,
  compendiumImportSchema,
  deepFreeze,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilterProperty,
  nameFilteredListSchema,
  paginationProperties,
  patchFrom
} from "./shared.js";

const cardBackSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" }, // blank:true, ABSENT when unset — no minLength
    text: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 }
  },
  additionalProperties: false
};

const cardFaceSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    text: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 }
  },
  additionalProperties: false
};

const cardCreateSchema = {
  type: "object",
  required: ["name"], // StringField blank:false with no initial (executed: "" and "   " rejected)
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },

    type: { type: "string", minLength: 1 },
    system: freeformObjectSchema,
    suit: { type: "string" }, // blank IS legal in Foundry — no minLength (over-refusal otherwise)
    value: { type: ["number", "null"] }, // a NumberField: "K" is rejected by Foundry itself
    back: cardBackSchema,
    faces: { type: "array", items: cardFaceSchema },
    face: { type: ["integer", "null"], minimum: 0 }, // -1 silently clamps to face 0
    width: { type: ["integer", "null"], minimum: 1 }, // v14 clamps 0/-2 to 1; v13 throws
    height: { type: ["integer", "null"], minimum: 1 },

    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
    sort: { type: "integer" },
    flags: freeformObjectSchema
    // NO `drawn`, NO `origin` (movement state — the action verbs only), NO `img` (derived getter)
  },
  additionalProperties: false
};

const cardPatchSchema = patchFrom(cardCreateSchema, { omit: ["type"] });

const cardsDataSchema = {
  type: "object",
  required: ["name", "type"], // `type` has NO initial — Foundry throws without it
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["deck", "hand", "pile"] }, // bridge POLICY — see the note above
    description: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 }, // nullable, NOT blankable (--clear-img → null)
    system: freeformObjectSchema,
    width: { type: ["integer", "null"], minimum: 1 },
    height: { type: ["integer", "null"], minimum: 1 },

    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
    displayCount: { type: "boolean" },

    folder: { type: ["string", "null"], minLength: 1 },
    sort: { type: "integer" },
    flags: freeformObjectSchema,

    cards: { type: "array", items: cardCreateSchema }
  },
  additionalProperties: false
};

// NO `type` (not patchable — Foundry throws on both installs) and NO `cards` (fields-only
// update; a top-level `{cards:[…]}` really writes embedded rows → use cards.card.*)
const cardsPatchSchema = patchFrom(cardsDataSchema, { omit: ["type", "cards"] });

export const CARDS_DELETE_CHAT_STATUSES = deepFreeze(["dispatched", "unknown", "not-requested"]);

export const CARDS_RECALL_STATUSES = deepFreeze(["not-executed", "confirmed", "unconfirmed", "not-verified"]);

export const CARDS_RECALL_CONSEQUENCE_SCOPES = deepFreeze(["applied", "prospective", "unknown"]);

export const CARDS_DRAW_MODES = deepFreeze(["top", "bottom", "random"]);

export const CARDS_ACTION_CHAT_STATUSES = deepFreeze([
  "dispatched",
  "not-requested",
  "not-dispatched",
  "unknown"
]);

export const CARDS_ACTION_MUTATION_OUTCOMES = deepFreeze(["committed", "partial", "unknown", "not-executed"]);

export const CARDS_ACTION_RECONCILIATIONS = deepFreeze(["confirmed", "best-effort", "not-executed"]);

const cardsActionChatProperty = { chat: { type: "boolean" } };

const cardsMoveCountProperty = { count: { type: "integer", minimum: 1 } };

const cardsIdSchema = {
  type: "object",
  required: ["cardsId"],
  properties: { cardsId: { type: "string", minLength: 1 } },
  additionalProperties: false
};

export const cardsCommands = {
  "cards.list": cmd(nameFilteredListSchema),
  "cards.get": cmd(cardsIdSchema),
  "cards.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "cards.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: cardsDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.update": cmd(
    {
      type: "object",
      required: ["cardsId", "patch"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        patch: cardsPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.clone": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        patch: cardsPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.import-from-compendium": cmd(compendiumImportSchema(cardsPatchSchema), { mutation: true }),
  "cards.delete": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.ownership.set": cmd(ownershipSetSchema("cardsId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "cards.shuffle": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.reset": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.deal": cmd(
    {
      type: "object",
      required: ["cardsId", "to", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        to: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 }
        },
        ...cardsMoveCountProperty,
        how: { type: "string", enum: [...CARDS_DRAW_MODES] },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.draw": cmd(
    {
      type: "object",
      required: ["cardsId", "from", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        from: { type: "string", minLength: 1 },
        ...cardsMoveCountProperty,
        how: { type: "string", enum: [...CARDS_DRAW_MODES] },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.pass": cmd(
    {
      type: "object",
      required: ["cardsId", "to", "cardIds", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
        cardIds: {
          type: "array",
          minItems: 1,
          maxItems: CARDS_PASS_MAX_IDS,
          items: { type: "string", minLength: 1 }
        },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.list": cmd({
    type: "object",
    required: [],
    properties: {
      cardsId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "cards.card.get": cmd({
    type: "object",
    required: ["cardsId", "cardId"],
    properties: {
      cardsId: { type: "string", minLength: 1 },
      cardId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "cards.card.create": cmd(
    {
      type: "object",
      required: ["cardsId", "data"],
      properties: {
        cardsId: { type: "string", minLength: 1 },

        data: cardCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.update": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId", "patch"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        patch: cardPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.clone": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        patch: cardPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.delete": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
