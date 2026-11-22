import { afterEach, describe, expect, it } from "vitest";

import { planOwnershipWrite } from "../scripts/lib/ownership.js";

describe("ownership write plan", () => {
  const originalFoundry = globalThis.foundry;

  afterEach(() => {
    globalThis.foundry = originalFoundry;
  });

  const target = (ownership) => ({ toObject: () => ({ ownership }) });

  it("merges levels when no stored entry is removed", () => {
    globalThis.foundry = undefined;

    expect(
      planOwnershipWrite(target({ default: 0, u1: 2 }), { defaultLevel: 1, users: { u2: 3, u3: null } })
    ).toEqual({
      ownership: { default: 1, u1: 2, u2: 3 },
      patch: { ownership: { default: 1, u1: 2, u2: 3 } }
    });
  });

  it("replaces the whole map with a forced-replacement key on a core without data operators", () => {
    globalThis.foundry = { utils: {} };

    expect(planOwnershipWrite(target({ default: 0, u1: 2 }), { users: { u1: null } })).toEqual({
      ownership: { default: 0 },
      patch: { "==ownership": { default: 0 } }
    });
  });

  it("replaces the whole map with the ForcedReplacement operator where the core provides one", () => {
    class ForcedReplacement {
      constructor(value) {
        this.value = value;
      }

      static create(value) {
        return new ForcedReplacement(value);
      }
    }
    globalThis.foundry = { data: { operators: { ForcedReplacement } } };

    const { ownership, patch } = planOwnershipWrite(target({ default: -1, u1: 3, u2: 1 }), {
      users: { u1: null, u2: -1 }
    });

    expect(ownership).toEqual({ default: -1, u2: -1 });
    expect(Object.keys(patch)).toEqual(["ownership"]);
    expect(patch.ownership).toBeInstanceOf(ForcedReplacement);
    expect(patch.ownership.value).toEqual({ default: -1, u2: -1 });
  });
});
