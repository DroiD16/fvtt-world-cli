import { describe, expect, it } from "vitest";

import { IdempotencyCache, computeRequestFingerprint } from "../src/bridge/idempotency-cache.js";
import type { CommandResponseEnvelope } from "../src/transport-util.js";

function okResponse(id: string, result: unknown): CommandResponseEnvelope {
  return {
    protocolVersion: "1.0",
    type: "command.response",
    id,
    ok: true,
    result
  };
}

describe("computeRequestFingerprint", () => {
  it("is stable regardless of object key insertion order", () => {
    const a = computeRequestFingerprint("item.create", {
      data: { name: "Sword", type: "weapon" },
      dryRun: false
    });
    const b = computeRequestFingerprint("item.create", {
      dryRun: false,
      data: { type: "weapon", name: "Sword" }
    });
    expect(a).toBe(b);
  });

  it("excludes the idempotency key itself from the fingerprint", () => {
    const withKey = computeRequestFingerprint("item.create", {
      data: { name: "Sword", type: "weapon" },
      idempotencyKey: "k1"
    });
    const withoutKey = computeRequestFingerprint("item.create", {
      data: { name: "Sword", type: "weapon" }
    });
    expect(withKey).toBe(withoutKey);
  });

  it("differs when the command differs", () => {
    const params = { data: { name: "Sword", type: "weapon" } };
    expect(computeRequestFingerprint("item.create", params)).not.toBe(
      computeRequestFingerprint("actor.create", params)
    );
  });

  it("differs when params differ", () => {
    expect(computeRequestFingerprint("item.create", { data: { name: "Sword", type: "weapon" } })).not.toBe(
      computeRequestFingerprint("item.create", { data: { name: "Shield", type: "armor" } })
    );
  });

  it("keeps array order significant", () => {
    expect(computeRequestFingerprint("x", { tags: ["a", "b"] })).not.toBe(
      computeRequestFingerprint("x", { tags: ["b", "a"] })
    );
  });

  it("keeps dryRun in the fingerprint", () => {
    expect(computeRequestFingerprint("item.create", { data: {}, dryRun: true })).not.toBe(
      computeRequestFingerprint("item.create", { data: {}, dryRun: false })
    );
  });
});

describe("IdempotencyCache", () => {
  it("returns a miss for an unknown key", () => {
    const cache = new IdempotencyCache();
    expect(cache.lookup("k", "fp").status).toBe("miss");
  });

  it("returns a hit with the stored response for the same key + fingerprint", () => {
    const cache = new IdempotencyCache();
    const stored = okResponse("orig", { item: { id: "i1" } });
    cache.store("k", "fp", stored);

    const lookup = cache.lookup("k", "fp");
    expect(lookup.status).toBe("hit");
    if (lookup.status === "hit") {
      expect(lookup.response).toBe(stored);
    }
  });

  it("returns a conflict for the same key but a different fingerprint", () => {
    const cache = new IdempotencyCache();
    cache.store("k", "fp-1", okResponse("orig", {}));
    expect(cache.lookup("k", "fp-2").status).toBe("conflict");
  });

  it("lazily expires an entry past its TTL (no timer)", () => {
    let clock = 1000;
    const cache = new IdempotencyCache({ ttlMs: 100, now: () => clock });
    cache.store("k", "fp", okResponse("orig", {}));

    clock = 1099;
    expect(cache.lookup("k", "fp").status).toBe("hit");

    clock = 1100;
    expect(cache.lookup("k", "fp").status).toBe("miss");

    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry when the cap is exceeded", () => {
    const cache = new IdempotencyCache({ maxEntries: 2 });
    cache.store("a", "fp-a", okResponse("a", {}));
    cache.store("b", "fp-b", okResponse("b", {}));
    cache.store("c", "fp-c", okResponse("c", {}));

    expect(cache.size).toBe(2);
    expect(cache.lookup("a", "fp-a").status).toBe("miss");
    expect(cache.lookup("b", "fp-b").status).toBe("hit");
    expect(cache.lookup("c", "fp-c").status).toBe("hit");
  });

  it("refreshes a re-stored key to newest (so it survives eviction)", () => {
    let clock = 1000;
    const cache = new IdempotencyCache({ maxEntries: 2, now: () => clock });
    cache.store("a", "fp-a", okResponse("a", {}));
    cache.store("b", "fp-b", okResponse("b", {}));

    cache.store("a", "fp-a", okResponse("a2", {}));
    cache.store("c", "fp-c", okResponse("c", {}));

    expect(cache.lookup("a", "fp-a").status).toBe("hit");
    expect(cache.lookup("b", "fp-b").status).toBe("miss");
  });

  it("storeIfAbsent keeps the FIRST live entry and reports whether it stored", () => {
    const cache = new IdempotencyCache();
    const first = okResponse("orig", { item: { id: "first" } });
    expect(cache.storeIfAbsent("k", "fp", first)).toBe(true);

    const second = okResponse("orig", { item: { id: "second" } });
    expect(cache.storeIfAbsent("k", "fp", second)).toBe(false);
    const hit = cache.lookup("k", "fp");
    expect(hit.status).toBe("hit");
    if (hit.status === "hit") {
      expect(hit.response).toBe(first);
    }
  });

  it("storeIfAbsent refuses to replace a live entry even under a different fingerprint", () => {
    const cache = new IdempotencyCache();
    cache.storeIfAbsent("k", "fp-a", okResponse("orig", {}));

    expect(cache.storeIfAbsent("k", "fp-b", okResponse("orig", {}))).toBe(false);
    expect(cache.lookup("k", "fp-a").status).toBe("hit");
    expect(cache.lookup("k", "fp-b").status).toBe("conflict");
  });

  it("storeIfAbsent treats an EXPIRED entry as absent and stores fresh (no lookup needed)", () => {
    let clock = 1000;
    const cache = new IdempotencyCache({ ttlMs: 100, now: () => clock });
    cache.storeIfAbsent("k", "fp", okResponse("orig", { item: { id: "stale" } }));

    clock = 1100;
    const fresh = okResponse("orig", { item: { id: "fresh" } });
    expect(cache.storeIfAbsent("k", "fp", fresh)).toBe(true);
    const hit = cache.lookup("k", "fp");
    expect(hit.status).toBe("hit");
    if (hit.status === "hit") {
      expect(hit.response).toBe(fresh);
    }
  });

  it("clear() empties the cache", () => {
    const cache = new IdempotencyCache();
    cache.store("a", "fp-a", okResponse("a", {}));
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
