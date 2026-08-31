import { ERROR_CODES } from "../generated/protocol.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createBridgeError, isFoundryValidationError, toFailureSummary } from "../lib/errors.js";
import { getUserById, getUsersCollection } from "../lib/game-collections.js";
import { filterByName, paginate, serializeUser } from "../lib/serializers.js";
import { previewDocumentCreate, previewDocumentUpdate } from "../lib/world-docs.js";
import { assertAssignableUserRole, assertKnownUserPermissions, getGame } from "../lib/validators.js";

const FOUNDRY_REFUSAL_PATTERN = /permission|not authorized|not allowed|cannot|last gamemaster/i;

function resolveUserClass() {
  const DocumentClass = getUsersCollection().documentClass ?? /** @type {any} */ (globalThis).User;
  if (!DocumentClass) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry User document class is not available; reload the GM client"
    );
  }

  return DocumentClass;
}

/**
 * @param {string} userId
 * @param {string} command
 */
function assertNotOwnUser(userId, command) {
  const own = getGame().user?.id ?? null;
  if (own === null) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `${command} may not touch the user account this bridge runs through, and this client cannot say which ` +
        `account that is, so the guard refuses rather than guess. Nothing was written. Reload the GM client and ` +
        `retry`,
      { userId, command }
    );
  }

  if (userId !== own) {
    return;
  }

  throw createBridgeError(
    ERROR_CODES.USER_SELF_PROTECTED,
    `${command} targets the very user account this bridge runs through, and the bridge refuses that regardless of ` +
      `the command policy: demoting or deleting it would cut the connection the caller is using and could not be ` +
      `undone from the CLI. Nothing was written. Never retry; a human can make this change in Foundry, or the ` +
      `command can address another user`,
    { userId, command }
  );
}

/**
 * @param {unknown} error
 * @param {{ command: string, userId?: string }} context
 */
function mapUserWriteFailure(error, { command, userId }) {
  if (isFoundryValidationError(error) || /** @type {any} */ (error)?.code) {
    return error;
  }

  const summary = toFailureSummary(error);
  if (!FOUNDRY_REFUSAL_PATTERN.test(summary.message)) {
    return error;
  }

  return createBridgeError(
    ERROR_CODES.PERMISSION_DENIED,
    `Foundry refused ${command}; see details.message for its own words. Foundry enforces limits the bridge cannot ` +
      `lift: no user may be given a role above the caller's own, the world keeps at least one gamemaster, and only ` +
      `a full gamemaster may write another user's permissions. Nothing was written`,
    { command, ...(userId ? { userId } : null), message: summary.message }
  );
}

/**
 * @param {any} user
 * @param {"create"|"update"|"delete"} action
 * @param {Record<string, unknown>} changes
 * @param {string} command
 */
function assertFoundryAllowsWrite(user, action, changes, command) {
  const game = getGame();
  if (typeof user?.canUserModify !== "function") {
    return;
  }

  if (!user.canUserModify(game.user, action, changes)) {
    throw createBridgeError(
      ERROR_CODES.PERMISSION_DENIED,
      `Foundry does not let this GM user ${action} user ${user.id ?? "(unknown)"}: a role change may never exceed ` +
        `the caller's own role, and only a full gamemaster may write another user's permissions. Nothing was written`,
      { command, userId: user.id ?? null, action }
    );
  }
}

/**
 * @param {Record<string, boolean | null>} requested
 */
function buildPermissionsPatch(requested) {
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const [name, value] of Object.entries(requested)) {
    if (value === null) {
      patch[`-=${name}`] = null;
    } else {
      patch[name] = value;
    }
  }

  return patch;
}

/**
 * @param {any} user
 */
function readStoredPermissions(user) {
  const stored = user?.permissions;
  return stored && typeof stored === "object" ? { ...stored } : {};
}

/**
 * @param {any} user
 * @param {string[]} known
 */
function readEffectivePermissions(user, known) {
  if (typeof user?.hasPermission !== "function") {
    return null;
  }

  /** @type {Record<string, boolean>} */
  const effective = {};
  for (const name of known) {
    try {
      effective[name] = Boolean(user.hasPermission(name));
    } catch {
      return null;
    }
  }

  return effective;
}

/**
 * @param {any} user
 * @param {string[]} known
 */
function permissionsResult(user, known) {
  return {
    userId: user.id ?? null,
    role: user.role ?? null,
    overrides: readStoredPermissions(user),
    permissions: readEffectivePermissions(user, known)
  };
}

/**
 * @param {Record<string, boolean | null>} requested
 * @param {Record<string, unknown>} stored
 * @param {string} command
 */
function assertPermissionsConfirmed(requested, stored, command) {
  const unapplied = Object.entries(requested).filter(([name, value]) =>
    value === null ? Object.hasOwn(stored, name) : stored[name] !== value
  );
  if (unapplied.length === 0) {
    return;
  }

  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${command} was accepted by Foundry and then read back with ${unapplied
      .map(([name]) => name)
      .join(", ")} still unchanged, so the requested state did not land. Re-read the user before retrying`,
    { command, unapplied: unapplied.map(([name]) => name), stored }
  );
}

export function createUserHandlers() {
  return {
    async "user.list"(params) {
      const users = filterByName(Array.from(getUsersCollection()), params.name);
      const { page, total, hasMore } = paginate(users, params);
      return {
        users: page.map((user) => serializeUser(user)),
        total,
        hasMore
      };
    },

    async "user.get"(params) {
      return {
        user: serializeUser(getUserById(params.userId))
      };
    },

    async "user.create"(params) {
      const command = "user.create";
      const data = params.data;
      if (data.role !== undefined) {
        assertAssignableUserRole(data.role);
      }

      const DocumentClass = resolveUserClass();
      if (isDryRun(params)) {
        return dryRunResponse({ user: serializeUser(previewDocumentCreate(DocumentClass, data)) });
      }

      if (typeof DocumentClass.create !== "function") {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          "Foundry User creation API is not available; reload the GM client"
        );
      }

      let created;
      try {
        created = await DocumentClass.create(data, { render: true });
      } catch (error) {
        throw mapUserWriteFailure(error, { command });
      }

      if (!created?.id) {
        throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "User.create returned no document");
      }

      const stored = getUsersCollection().get?.(created.id) ?? null;
      if (!stored) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry reported user ${created.id} as created and the world's user list does not contain it, so the ` +
            `creation is unconfirmed. Re-read with \`user list\` before retrying`,
          { command, userId: created.id }
        );
      }

      return { user: serializeUser(stored) };
    },

    async "user.update"(params) {
      const command = "user.update";
      const user = getUserById(params.userId);
      const patch = params.patch;
      assertFoundryAllowsWrite(user, "update", patch, command);

      if (isDryRun(params)) {
        return dryRunResponse({ user: serializeUser(await previewDocumentUpdate(user, patch)) });
      }

      try {
        await user.update(patch, { diff: true, render: true });
      } catch (error) {
        throw mapUserWriteFailure(error, { command, userId: params.userId });
      }

      return { user: serializeUser(getUserById(params.userId)) };
    },

    async "user.delete"(params) {
      const command = "user.delete";
      assertNotOwnUser(params.userId, command);
      const user = getUserById(params.userId);
      const id = user.id ?? params.userId;
      assertFoundryAllowsWrite(user, "delete", {}, command);

      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      if (typeof user.delete !== "function") {
        throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry document delete API is not available");
      }

      try {
        await user.delete({ render: true });
      } catch (error) {
        throw mapUserWriteFailure(error, { command, userId: id });
      }

      if (getUsersCollection().get?.(id)) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry accepted the deletion of user ${id} and the world's user list still contains it, so the ` +
            `deletion is unconfirmed. Re-read with \`user list\` before retrying`,
          { command, userId: id }
        );
      }

      return { id, deleted: true };
    },

    async "user.role.set"(params) {
      const command = "user.role.set";
      assertNotOwnUser(params.userId, command);
      const roleName = assertAssignableUserRole(params.role);
      const user = getUserById(params.userId);
      const previousRole = user.role ?? null;
      assertFoundryAllowsWrite(user, "update", { role: params.role }, command);

      if (isDryRun(params)) {
        return dryRunResponse({
          userId: user.id ?? params.userId,
          previousRole,
          role: params.role,
          roleName,
          changed: previousRole !== params.role
        });
      }

      if (previousRole === params.role) {
        return {
          userId: user.id ?? params.userId,
          previousRole,
          role: params.role,
          roleName,
          changed: false
        };
      }

      try {
        await user.update({ role: params.role }, { diff: true, render: true });
      } catch (error) {
        throw mapUserWriteFailure(error, { command, userId: params.userId });
      }

      const stored = getUserById(params.userId);
      if ((stored.role ?? null) !== params.role) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry accepted the role change for user ${params.userId} and then reported role ${stored.role}, so the ` +
            `requested role did not land: the server refuses a role change it considers unauthorized. Re-read the ` +
            `user before retrying`,
          { command, userId: params.userId, requested: params.role, stored: stored.role ?? null }
        );
      }

      return {
        userId: stored.id ?? params.userId,
        previousRole,
        role: params.role,
        roleName,
        changed: true
      };
    },

    async "user.permissions.set"(params) {
      const command = "user.permissions.set";
      const known = assertKnownUserPermissions(params.permissions);
      const user = getUserById(params.userId);
      const patch = buildPermissionsPatch(params.permissions);
      assertFoundryAllowsWrite(user, "update", { permissions: patch }, command);

      if (isDryRun(params)) {
        return dryRunResponse({
          ...permissionsResult(user, known),
          requested: params.permissions
        });
      }

      try {
        await user.update({ permissions: patch }, { diff: false, render: true });
      } catch (error) {
        throw mapUserWriteFailure(error, { command, userId: params.userId });
      }

      const stored = getUserById(params.userId);
      assertPermissionsConfirmed(params.permissions, readStoredPermissions(stored), command);
      return permissionsResult(stored, known);
    }
  };
}
