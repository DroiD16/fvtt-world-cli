import { describe, expect, it } from "vitest";

import { createMutationQueue } from "../scripts/lib/mutation-queue.js";

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return Promise.resolve();
}

describe("createMutationQueue", () => {
  it("serializes tasks: a queued task does not start until the previous one settles", async () => {
    const queue = createMutationQueue();
    const order = [];
    const gate = deferred();

    const p1 = queue.run(async () => {
      order.push("t1-start");
      await gate.promise;
      order.push("t1-end");
      return "one";
    });

    const p2 = queue.run(async () => {
      order.push("t2-start");
      return "two";
    });

    await flushMicrotasks();
    await flushMicrotasks();
    expect(order).toEqual(["t1-start"]);

    gate.resolve();
    await expect(p1).resolves.toBe("one");
    await expect(p2).resolves.toBe("two");
    expect(order).toEqual(["t1-start", "t1-end", "t2-start"]);
  });

  it("isolates errors: a rejecting task does not poison the queue, and its caller still sees the rejection", async () => {
    const queue = createMutationQueue();
    const order = [];

    const boom = new Error("boom");
    const p1 = queue.run(async () => {
      order.push("t1");
      throw boom;
    });
    const p2 = queue.run(async () => {
      order.push("t2");
      return "ok";
    });

    await expect(p1).rejects.toBe(boom);

    await expect(p2).resolves.toBe("ok");
    expect(order).toEqual(["t1", "t2"]);
  });

  it("runs a following task strictly AFTER a prior rejection settles (ordering preserved through failure)", async () => {
    const queue = createMutationQueue();
    const order = [];
    const gate = deferred();

    const p1 = queue.run(async () => {
      order.push("t1-start");
      await gate.promise;
      order.push("t1-reject");
      throw new Error("t1 failed");
    });
    const p2 = queue.run(async () => {
      order.push("t2-start");
      return "two";
    });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(order).toEqual(["t1-start"]);

    gate.resolve();
    await expect(p1).rejects.toThrow("t1 failed");
    await expect(p2).resolves.toBe("two");
    expect(order).toEqual(["t1-start", "t1-reject", "t2-start"]);
  });
});
