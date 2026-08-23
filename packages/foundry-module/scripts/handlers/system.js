import {
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DISCOVERABLE_COMMAND_NAMES,
  MODULE_ID,
  MODULE_TITLE
} from "../generated/protocol.js";

export function createSystemHandlers({ bridgeClient }) {
  return {
    async "system.ping"() {
      return {
        pong: true,
        timestamp: new Date().toISOString(),
        bridge: bridgeClient.getStatus()
      };
    },

    async "system.info"() {
      const game = globalThis.game;
      const manifest = game.modules?.get?.(MODULE_ID);
      return {
        module: {
          id: MODULE_ID,
          title: MODULE_TITLE,
          version: manifest?.version ?? "0.0.0"
        },

        foundry: {
          version: game.version ?? game.release?.version ?? "unknown",
          generation: game.release?.generation ?? null
        },

        system: {
          id: game.system?.id ?? "unknown",
          version: game.system?.version ?? "unknown"
        },

        modules:
          game.modules?.contents?.map((m) => ({
            id: m.id,
            title: m.title,
            version: m.version,
            active: m.active
          })) ?? [],
        world: {
          id: game.world?.id ?? "unknown-world",
          title: game.world?.title ?? "Unknown World"
        },
        user: {
          id: game.user?.id ?? "unknown-user",
          name: game.user?.name ?? "Unknown User",
          isGM: Boolean(game.user?.isGM)
        },
        bridge: bridgeClient.getStatus(),

        limits: bridgeClient.getLimitsInfo?.() ?? {
          uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
          wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES,
          uploadSource: "default"
        },
        commands: DISCOVERABLE_COMMAND_NAMES
      };
    }
  };
}
