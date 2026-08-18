import { MODULE_ID } from "../generated/protocol.js";

/** @type {Set<(snapshot: Record<string, any> | null) => void>} */
const subscribers = new Set();

/**
 * @param {(snapshot: Record<string, any> | null) => void} handler
 * @returns {() => void}
 */
export function subscribeStatus(handler) {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/** @param {Record<string, any> | null} snapshot */
export function publishStatus(snapshot) {
  for (const handler of [...subscribers]) {
    try {
      handler(snapshot);
    } catch (error) {
      console.warn(`[${MODULE_ID}] Bridge status subscriber failed`, error);
    }
  }
}

/** @param {any} application */
export function isSupersededApplication(application) {
  const registered = globalThis.foundry?.applications?.instances?.get?.(application.id);
  if (registered && registered !== application) return true;
  const element = application.element;
  return Boolean(element) && element.isConnected === false;
}

/** @param {any} Base */
export function withStatusRefresh(Base) {
  return class extends Base {
    /** @type {(() => void) | null} */
    #unsubscribeStatus = null;

    #stopStatusRefresh() {
      this.#unsubscribeStatus?.();
      this.#unsubscribeStatus = null;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.#unsubscribeStatus ??= subscribeStatus(() => {
        if (isSupersededApplication(this)) {
          this.#stopStatusRefresh();
          return;
        }
        void this.render({ force: false });
      });
    }

    _onClose(options) {
      super._onClose(options);
      this.#stopStatusRefresh();
    }
  };
}
