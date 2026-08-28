import {
  AUTH_AWAIT_PARK_CAP_MS,
  CLIENT_ID_MAX_LENGTH,
  CLIENT_ID_MIN_LENGTH,
  CLIENT_ID_PATTERN,
  CLIENT_LABEL_MAX_LENGTH,
  CLIENT_LABEL_PATTERN,
  ERROR_CODES,
  MESSAGE_TYPES,
  MODULE_ID,
  PROTOCOL_VERSION
} from "./constants.js";
import { actorCommands, actorCompendiumImportCommands } from "./schemas/actor.js";
import { approvalCommands } from "./schemas/approval.js";
import { cardsCommands } from "./schemas/cards.js";
import { chatCommands } from "./schemas/chat.js";
import { combatCommands } from "./schemas/combat.js";
import { compendiumCommands } from "./schemas/compendium.js";
import { fileCommands, worldAuditCommands } from "./schemas/file.js";
import { folderCommands } from "./schemas/folder.js";
import { itemCommands } from "./schemas/item.js";
import { journalCommands } from "./schemas/journal.js";
import { macroCommands } from "./schemas/macro.js";
import { userCommands } from "./schemas/ownership-users.js";
import { playlistCommands } from "./schemas/playlist.js";
import { sceneEmbeddedCommands } from "./schemas/scene-embedded.js";
import { sceneCommands } from "./schemas/scene.js";
import { worldSearchCommands } from "./schemas/search.js";
import { settingCommands } from "./schemas/settings.js";
import { deepFreeze, emptyObjectSchema, mergeCommandFamilies } from "./schemas/shared.js";
import { systemCommands } from "./schemas/system.js";
import { tableCommands } from "./schemas/table.js";

export {
  APPROVAL_AWAIT_COMMAND,
  APPROVAL_CANCEL_COMMAND,
  POLICY_SNAPSHOT_COMMAND
} from "./schemas/approval.js";
export {
  CARDS_ACTION_CHAT_STATUSES,
  CARDS_ACTION_MUTATION_OUTCOMES,
  CARDS_ACTION_RECONCILIATIONS,
  CARDS_DELETE_CHAT_STATUSES,
  CARDS_DRAW_MODES,
  CARDS_RECALL_CONSEQUENCE_SCOPES,
  CARDS_RECALL_STATUSES
} from "./schemas/cards.js";
export { CHAT_CAPTURE_STATUSES } from "./schemas/chat.js";
export {
  COMBAT_INITIATIVE_MODES,
  COMBAT_INITIATIVE_SELECTIONS,
  COMBAT_MUTATION_OUTCOMES,
  COMBAT_ROLL_MODES,
  COMBAT_TRANSITIONS
} from "./schemas/combat.js";
export { AUDIT_FILE_SCOPES } from "./schemas/file.js";
export { TABLE_MUTATION_OUTCOMES, TABLE_ROLL_MODES } from "./schemas/table.js";

export const COMMAND_DEFINITIONS = deepFreeze(
  mergeCommandFamilies([
    systemCommands,
    sceneCommands,
    sceneEmbeddedCommands,
    itemCommands,
    journalCommands,
    macroCommands,
    playlistCommands,
    tableCommands,
    combatCommands,
    cardsCommands,
    chatCommands,
    actorCommands,
    fileCommands,
    compendiumCommands,
    folderCommands,
    userCommands,
    settingCommands,
    actorCompendiumImportCommands,
    worldAuditCommands,
    worldSearchCommands,
    approvalCommands
  ])
);

export const COMMAND_NAMES = deepFreeze(Object.keys(COMMAND_DEFINITIONS));

export const WRITE_COMMANDS = deepFreeze(
  COMMAND_NAMES.filter((command) => COMMAND_DEFINITIONS[command].mutation === true)
);

export const DISCOVERABLE_COMMAND_NAMES = deepFreeze(
  COMMAND_NAMES.filter((command) => COMMAND_DEFINITIONS[command].discovery !== false)
);

export const REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "command", "params"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.COMMAND_REQUEST },
    id: { type: "string", minLength: 1 },
    command: { type: "string", enum: COMMAND_NAMES },
    params: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false
};

const protocolErrorSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    details: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false
};

const limitsSchema = {
  type: "object",
  required: ["uploadBytes", "wsMaxPayloadBytes"],
  properties: {
    uploadBytes: { type: "integer", minimum: 1 },
    wsMaxPayloadBytes: { type: "integer", minimum: 1 }
  },
  additionalProperties: false
};

const openResultSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: true
};

export const CLIENT_ID_SCHEMA = {
  type: "string",
  minLength: CLIENT_ID_MIN_LENGTH,
  maxLength: CLIENT_ID_MAX_LENGTH,
  pattern: CLIENT_ID_PATTERN
};

export const CLIENT_LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: CLIENT_LABEL_MAX_LENGTH,
  pattern: CLIENT_LABEL_PATTERN
};

export const HELLO_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "pairingId", "credential", "clientId", "session"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_HELLO },
    pairingId: { type: "string", minLength: 1 },
    credential: { type: "string", minLength: 32 },
    clientId: CLIENT_ID_SCHEMA,
    session: {
      type: "object",
      required: ["moduleId", "moduleVersion", "world", "user", "commands"],
      properties: {
        moduleId: { type: "string", minLength: 1 },
        moduleVersion: { type: "string", minLength: 1 },
        world: {
          type: "object",
          required: ["id", "title"],
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 }
          },
          additionalProperties: false
        },
        user: {
          type: "object",
          required: ["id", "name", "isGM"],
          properties: {
            id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            isGM: { type: "boolean" }
          },
          additionalProperties: false
        },
        commands: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const CLIENT_HELLO_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "credential", "client"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.CLIENT_HELLO },
    credential: { type: "string", minLength: 43 },
    client: { type: "string", enum: ["cli", "companion"] }
  },
  additionalProperties: false
};

export const CLIENT_HELLO_ACK_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.CLIENT_HELLO_ACK },
    ok: { type: "boolean" },
    error: protocolErrorSchema
  },
  additionalProperties: false
};

export const PAIRING_REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "identity"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_REQUEST },
    identity: {
      type: "object",
      required: ["moduleId", "moduleVersion", "world", "user", "client"],
      properties: {
        moduleId: { type: "string", const: MODULE_ID },
        moduleVersion: { type: "string", minLength: 1 },
        world: HELLO_SCHEMA.properties.session.properties.world,
        user: HELLO_SCHEMA.properties.session.properties.user,
        client: {
          type: "object",
          required: ["id", "label"],
          properties: {
            id: CLIENT_ID_SCHEMA,
            label: CLIENT_LABEL_SCHEMA
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const PAIRING_PENDING_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "code", "expiresAt"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_PENDING },
    code: { type: "string", minLength: 8, maxLength: 8 },
    expiresAt: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const PAIRING_RESULT_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_RESULT },
    ok: { type: "boolean" },
    pairingId: { type: "string", minLength: 1 },
    credential: { type: "string", minLength: 32 },
    error: protocolErrorSchema
  },
  additionalProperties: false
};

export const DAEMON_OPERATIONS = deepFreeze([
  "auth.status",
  "auth.pending",
  "auth.await",
  "auth.approve",
  "auth.deny",
  "auth.list",
  "auth.prune",
  "auth.revoke",
  "auth.rotate-client",
  "bridge.release"
]);

export const DAEMON_OPERATION_DEFINITIONS = deepFreeze({
  "auth.status": { paramsSchema: emptyObjectSchema },
  "auth.pending": { paramsSchema: emptyObjectSchema },
  "auth.await": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        timeoutMs: { type: "integer", minimum: 0, maximum: AUTH_AWAIT_PARK_CAP_MS }
      },
      additionalProperties: false
    }
  },
  "auth.approve": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        code: { type: "string", minLength: 8, maxLength: 8 }
      },
      additionalProperties: false
    }
  },
  "auth.deny": {
    paramsSchema: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", minLength: 8, maxLength: 8 } },
      additionalProperties: false
    }
  },
  "auth.list": { paramsSchema: emptyObjectSchema },
  "auth.prune": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        olderThanDays: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  "auth.revoke": {
    paramsSchema: {
      type: "object",
      required: ["pairingId"],
      properties: { pairingId: { type: "string", minLength: 1 } },
      additionalProperties: false
    }
  },
  "auth.rotate-client": { paramsSchema: emptyObjectSchema },
  "bridge.release": { paramsSchema: emptyObjectSchema }
});

export const DAEMON_REQUEST_VARIANT_SCHEMAS = deepFreeze(
  Object.fromEntries(
    DAEMON_OPERATIONS.map((operation) => [
      operation,
      {
        type: "object",
        required: ["protocolVersion", "type", "id", "operation", "params"],
        properties: {
          protocolVersion: { type: "string", const: PROTOCOL_VERSION },
          type: { type: "string", const: MESSAGE_TYPES.DAEMON_REQUEST },
          id: { type: "string", minLength: 1 },
          operation: { type: "string", const: operation },
          params: DAEMON_OPERATION_DEFINITIONS[operation].paramsSchema
        },
        additionalProperties: false
      }
    ])
  )
);

export const DAEMON_REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "operation", "params"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.DAEMON_REQUEST },
    id: { type: "string", minLength: 1 },
    operation: { type: "string", enum: DAEMON_OPERATIONS },
    params: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false,
  oneOf: Object.values(DAEMON_REQUEST_VARIANT_SCHEMAS)
};

export const DAEMON_RESPONSE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "operation", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.DAEMON_RESPONSE },
    id: { type: "string", minLength: 1 },
    operation: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    result: openResultSchema,
    error: protocolErrorSchema
  },
  additionalProperties: false
};

export const BRIDGE_HELLO_ACK_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_HELLO_ACK },
    ok: { type: "boolean" },
    limits: limitsSchema,
    error: protocolErrorSchema
  },
  additionalProperties: false
};

export const BRIDGE_GOODBYE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_GOODBYE }
  },
  additionalProperties: false
};

export const COMMAND_RESPONSE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.COMMAND_RESPONSE },
    id: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    result: {},
    error: protocolErrorSchema
  },
  additionalProperties: false
};

export const TRANSPORT_MESSAGE_SCHEMAS = deepFreeze({
  [MESSAGE_TYPES.CLIENT_HELLO]: CLIENT_HELLO_SCHEMA,
  [MESSAGE_TYPES.CLIENT_HELLO_ACK]: CLIENT_HELLO_ACK_SCHEMA,
  [MESSAGE_TYPES.PAIRING_REQUEST]: PAIRING_REQUEST_SCHEMA,
  [MESSAGE_TYPES.PAIRING_PENDING]: PAIRING_PENDING_SCHEMA,
  [MESSAGE_TYPES.PAIRING_RESULT]: PAIRING_RESULT_SCHEMA,
  [MESSAGE_TYPES.DAEMON_REQUEST]: DAEMON_REQUEST_SCHEMA,
  [MESSAGE_TYPES.DAEMON_RESPONSE]: DAEMON_RESPONSE_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_HELLO]: HELLO_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_HELLO_ACK]: BRIDGE_HELLO_ACK_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_GOODBYE]: BRIDGE_GOODBYE_SCHEMA,
  [MESSAGE_TYPES.COMMAND_REQUEST]: REQUEST_SCHEMA,
  [MESSAGE_TYPES.COMMAND_RESPONSE]: COMMAND_RESPONSE_SCHEMA
});

export function isKnownCommand(command) {
  return Object.hasOwn(COMMAND_DEFINITIONS, command);
}

export function getCommandDefinition(command) {
  return COMMAND_DEFINITIONS[command] ?? null;
}

export function isWriteCommand(command) {
  return getCommandDefinition(command)?.mutation === true;
}

export function getInvalidCommandError(command) {
  return {
    code: ERROR_CODES.UNKNOWN_COMMAND,
    message: `Unsupported command: ${command}`,
    details: {
      command
    }
  };
}
