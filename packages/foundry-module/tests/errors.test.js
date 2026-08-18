import { afterEach, describe, expect, it } from "vitest";

import {
  createBridgeError,
  isFoundryValidationError,
  toFoundryValidationError,
  toProtocolError
} from "../scripts/lib/errors.js";

describe("isFoundryValidationError", () => {
  afterEach(() => {
    delete globalThis.foundry;
  });

  it("returns false for non-error values without throwing", () => {
    expect(isFoundryValidationError(undefined)).toBe(false);
    expect(isFoundryValidationError(null)).toBe(false);
    expect(isFoundryValidationError("nope")).toBe(false);
    expect(isFoundryValidationError(42)).toBe(false);
    expect(isFoundryValidationError(new Error("plain"))).toBe(false);
  });

  it("detects by error name when the namespaced class is absent", () => {
    const error = new Error("invalid");
    error.name = "DataModelValidationError";
    expect(isFoundryValidationError(error)).toBe(true);
  });

  it("detects by instanceof when the namespaced class is present", () => {
    class DataModelValidationError extends Error {}
    globalThis.foundry = { data: { validation: { DataModelValidationError } } };

    const error = new DataModelValidationError("invalid");
    error.name = "Error";
    expect(isFoundryValidationError(error)).toBe(true);
  });

  it("does not throw when foundry exists but the validation class does not", () => {
    globalThis.foundry = { data: { validation: {} } };
    expect(isFoundryValidationError(new Error("plain"))).toBe(false);
  });
});

describe("toFoundryValidationError", () => {
  it("maps to INVALID_PARAMS with reason and raw message", () => {
    const result = toFoundryValidationError(new Error("bad field"));
    expect(result.code).toBe("INVALID_PARAMS");
    expect(result.details.reason).toBe("foundry_validation");
    expect(result.details.message).toBe("bad field");
    expect(result.details.errors).toBeUndefined();
  });

  it("forwards structured field failure keys under details.errors", () => {
    const error = /** @type {any} */ (new Error("validation failed"));
    error.getAllFailures = () => ({
      name: { message: "required" },
      "system.hp": { message: "number" }
    });
    const result = toFoundryValidationError(error);
    expect(result.details.errors).toEqual(["name", "system.hp"]);
  });

  it("omits details.errors when getAllFailures returns undefined", () => {
    const error = /** @type {any} */ (new Error("validation failed"));
    error.getAllFailures = () => undefined;
    const result = toFoundryValidationError(error);
    expect(result.details.errors).toBeUndefined();
  });

  it("ignores a non-real `.fields` property (never a Foundry API)", () => {
    const error = /** @type {any} */ (new Error("validation failed"));
    error.fields = { name: new Error("required") };
    const result = toFoundryValidationError(error);
    expect(result.details.errors).toBeUndefined();
  });
});

describe("toProtocolError", () => {
  it("mirrors the message into details.message for a BridgeError(INTERNAL_ERROR) with empty details", () => {
    const error = createBridgeError("INTERNAL_ERROR", "boom");
    const result = toProtocolError(error);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.details.message).toBe("boom");
  });

  it("leaves an existing details.message untouched on INTERNAL_ERROR", () => {
    const error = createBridgeError("INTERNAL_ERROR", "wrapper", { message: "raw underlying" });
    const result = toProtocolError(error);
    expect(result.details.message).toBe("raw underlying");
  });

  it("passes non-INTERNAL_ERROR BridgeError details through unchanged", () => {
    const details = { path: "worlds/x", writeRoot: "worlds/x/fvtt-world-cli" };
    const error = createBridgeError("PATH_NOT_ALLOWED", "denied", details);
    const result = toProtocolError(error);
    expect(result.code).toBe("PATH_NOT_ALLOWED");

    expect(result.details).toBe(details);
    expect(result.details.message).toBeUndefined();
  });

  it("maps a plain Error to INTERNAL_ERROR with details.message", () => {
    const result = toProtocolError(new Error("unexpected"));
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("unexpected");
    expect(result.details.message).toBe("unexpected");
  });

  it("handles a non-Error throwable with a fallback message", () => {
    const result = toProtocolError("string failure");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.details.message).toBe("string failure");
  });

  it("back-fills details.message on SELF-DIAGNOSED INTERNAL_ERRORs too (duplicating the top-level message)", () => {
    const selfDiagnosed = [
      createBridgeError("INTERNAL_ERROR", "Folder f1 was NOT updated: …", {
        folderId: "f1",
        fields: ["name"],
        validationError: null
      }),
      createBridgeError("INTERNAL_ERROR", "Folder f1 was NOT deleted: …", { folderId: "f1", type: "Actor" }),

      createBridgeError("INTERNAL_ERROR", "Scene s1 thumbnail was generated but NOT persisted: …", {
        sceneId: "s1",
        persisted: false,
        sizeBytes: 1234
      }),

      createBridgeError("INTERNAL_ERROR", "Folder.create returned no document"),
      createBridgeError("INTERNAL_ERROR", "No base64 encoder is available")
    ];

    for (const error of selfDiagnosed) {
      const result = toProtocolError(error);
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.details.message).toBe(result.message);
    }
  });
});
