/** @returns {{ run: <T>(task: () => Promise<T> | T) => Promise<T> }} */
export function createMutationQueue() {
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();

  return {
    run(task) {
      const result = tail.catch(() => {}).then(() => task());

      tail = result.catch(() => {});
      return result;
    }
  };
}
