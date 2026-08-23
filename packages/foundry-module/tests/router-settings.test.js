import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { COMMAND_DEFINITIONS, ERROR_CODES, MODULE_ID } from "../scripts/generated/protocol.js";

import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

describe("settings read surface", () => {
  let router;

  function makeRouter() {
    return createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  }

  function makeDataFieldType(constructorName, settingId) {
    const FieldClass = /** @type {any} */ ({ [constructorName]: class {} })[constructorName];
    const field = /** @type {any} */ (new FieldClass());
    field.name = settingId;
    return field;
  }

  function createRegistry(entries) {
    return new Map(entries.map((entry) => [entry.id, /** @type {any} */ (entry)]));
  }

  /** @param {{ registry?: any, get?: (...args: any[]) => any, i18n?: any }} [options] */
  function setupGame({ registry, get = () => "value", i18n } = {}) {
    globalThis.game = {
      ready: true,
      world: { id: "world-1", title: "Test" },
      user: { id: "gm", name: "GM", isGM: true },
      userId: "gm",
      i18n: i18n ?? {
        localize: (key) =>
          ({
            "SETTINGS.TokenDragPreview": "Перетаскивание токена",
            "MODULE.ApiKeyName": "API Key",
            "MODULE.ApiKeyHint": "Secret key for the remote service"
          })[key] ?? key
      },
      settings: {
        settings: registry,
        get
      }
    };
    router = makeRouter();
  }

  const CORE_TOKEN_DRAG = {
    id: "core.tokenDragPreview",
    namespace: "core",
    key: "tokenDragPreview",
    name: "SETTINGS.TokenDragPreview",
    hint: undefined,
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  };

  const MODULE_API_KEY = {
    id: "my-module.apiKey",
    namespace: "my-module",
    key: "apiKey",
    name: "MODULE.ApiKeyName",
    hint: "MODULE.ApiKeyHint",
    scope: "world",
    config: false,
    requiresReload: true,
    type: String,
    default: ""
  };

  const CORE_TIME = {
    id: "core.time",
    namespace: "core",
    key: "time",
    scope: "world",
    type: makeDataFieldType("NumberField", "core.time"),
    default: 0
  };

  afterEach(() => {
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it("setting.list returns METADATA ONLY — no row carries a value, under any param", async () => {
    setupGame({ registry: createRegistry([MODULE_API_KEY, CORE_TOKEN_DRAG, CORE_TIME]) });
    const response = await router.route(createRequest("setting.list", { limit: 50 }));
    expect(response.ok).toBe(true);
    expect(response.result.total).toBe(3);
    expect(response.result.hasMore).toBe(false);
    for (const row of response.result.settings) {
      expect(row).not.toHaveProperty("value");
      expect(Object.keys(row).sort()).toEqual([
        "config",
        "hint",
        "hintLocalized",
        "id",
        "key",
        "name",
        "nameLocalized",
        "namespace",
        "requiresReload",
        "scope",
        "type"
      ]);
    }
  });

  it("setting.list projects raw and localized text as SEPARATE fields", async () => {
    setupGame({ registry: createRegistry([MODULE_API_KEY, CORE_TOKEN_DRAG]) });
    const rows = (await router.route(createRequest("setting.list"))).result.settings;
    const drag = rows.find((row) => row.id === "core.tokenDragPreview");
    expect(drag).toMatchObject({
      namespace: "core",
      key: "tokenDragPreview",
      id: "core.tokenDragPreview",
      name: "SETTINGS.TokenDragPreview",

      nameLocalized: "Перетаскивание токена",

      hint: null,
      hintLocalized: null,
      scope: "client",
      config: true,

      requiresReload: false,
      type: { kind: "Boolean" }
    });
    expect(rows.find((row) => row.id === "my-module.apiKey")).toMatchObject({
      scope: "world",
      config: false,
      requiresReload: true,
      hint: "MODULE.ApiKeyHint",
      hintLocalized: "Secret key for the remote service"
    });
  });

  it("reports an UNTRANSLATED raw string verbatim (Foundry's own localize fallback)", async () => {
    setupGame({
      registry: createRegistry([{ ...MODULE_API_KEY, name: "Daemon URL", hint: undefined }]),
      i18n: { localize: (key) => key }
    });
    const row = (await router.route(createRequest("setting.list"))).result.settings[0];
    expect(row.name).toBe("Daemon URL");
    expect(row.nameLocalized).toBe("Daemon URL");
  });

  it("describes the type as {kind} from the CONSTRUCTOR for a DataField (never the poisoned type.name)", async () => {
    setupGame({
      registry: createRegistry([
        CORE_TIME,
        { ...MODULE_API_KEY, id: "m.model", key: "model", type: class MyModel {} },
        {
          ...MODULE_API_KEY,
          id: "m.anon",
          key: "anon",
          type: Object.defineProperty(() => 1, "name", { value: "" })
        },
        { ...MODULE_API_KEY, id: "m.typeless", key: "typeless", type: undefined }
      ])
    });
    const rows = (await router.route(createRequest("setting.list"))).result.settings;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId["core.time"].type).toEqual({ kind: "NumberField" });
    expect(byId["core.time"].name).not.toBe("core.time");

    expect(byId["m.model"].type).toEqual({ kind: "MyModel" });

    expect(byId["m.anon"].type).toEqual({ kind: "(anonymous)" });

    expect(byId["m.typeless"].type).toBeNull();
  });

  it("sorts by the (namespace, key) TUPLE, not by the dotted id", async () => {
    setupGame({
      registry: createRegistry([
        { id: "core-extra.a", namespace: "core-extra", key: "a", scope: "world" },
        { id: "core.z", namespace: "core", key: "z", scope: "world" },
        { id: "core.a", namespace: "core", key: "a", scope: "world" }
      ])
    });
    const ids = (await router.route(createRequest("setting.list"))).result.settings.map((row) => row.id);
    expect(ids).toEqual(["core.a", "core.z", "core-extra.a"]);
    expect(ids).not.toEqual([...ids].sort());
  });

  it("paginates AFTER sorting, and total/hasMore describe the filtered set", async () => {
    setupGame({
      registry: createRegistry([
        { id: "b.one", namespace: "b", key: "one", scope: "world" },
        { id: "a.one", namespace: "a", key: "one", scope: "world" },
        { id: "a.two", namespace: "a", key: "two", scope: "world" }
      ])
    });
    const page = await router.route(createRequest("setting.list", { limit: 2 }));
    expect(page.result.settings.map((row) => row.id)).toEqual(["a.one", "a.two"]);
    expect(page.result).toMatchObject({ total: 3, hasMore: true });

    const second = await router.route(createRequest("setting.list", { limit: 2, offset: 2 }));
    expect(second.result.settings.map((row) => row.id)).toEqual(["b.one"]);
    expect(second.result).toMatchObject({ total: 3, hasMore: false });

    const filtered = await router.route(createRequest("setting.list", { name: "a." }));
    expect(filtered.result).toMatchObject({ total: 0, hasMore: false });
  });

  it("filters on the namespace, the key, the RAW name AND the LOCALIZED label (four fields)", async () => {
    setupGame({ registry: createRegistry([MODULE_API_KEY, CORE_TOKEN_DRAG, CORE_TIME]) });
    const ids = async (name) =>
      (await router.route(createRequest("setting.list", { name }))).result.settings.map((row) => row.id);

    expect(await ids("my-mod")).toEqual(["my-module.apiKey"]);

    expect(await ids("APIKEY")).toEqual(["my-module.apiKey"]);

    expect(await ids("SETTINGS.Token")).toEqual(["core.tokenDragPreview"]);

    expect(await ids("токена")).toEqual(["core.tokenDragPreview"]);

    expect(await ids("core.tokenDrag")).toEqual([]);
    expect(await ids("core tokenDrag")).toEqual([]);
    expect(await ids("coretokenDrag")).toEqual([]);

    expect(await ids("TokenDragPreview Перетаскивание")).toEqual([]);
    expect(await ids("nothing-matches")).toEqual([]);
  });

  it("ISOLATES a hostile/broken registration: one bad row, not a dead command", async () => {
    const hostile = {
      id: "evil.module.boom",
      namespace: "evil.module",
      key: "boom",
      scope: "world",
      get name() {
        throw new Error("hostile getter");
      }
    };
    const hostileType = {
      id: "evil.type",
      namespace: "evil",
      key: "type",
      scope: "world",

      type: Object.defineProperty({}, "constructor", {
        get() {
          throw new Error("hostile constructor");
        }
      })
    };
    setupGame({ registry: createRegistry([CORE_TIME, hostile, hostileType]) });

    const response = await router.route(createRequest("setting.list"));
    expect(response.ok).toBe(true);
    expect(response.result.total).toBe(3);
    const byId = Object.fromEntries(response.result.settings.map((row) => [row.id, row]));

    expect(byId["core.time"]).toMatchObject({ type: { kind: "NumberField" } });
    expect(byId["core.time"]).not.toHaveProperty("metadataReadFailed");

    for (const id of ["evil.module.boom", "evil.type"]) {
      expect(byId[id]).toMatchObject({ id, name: null, type: null, metadataReadFailed: true });
      expect(byId[id].metadataReadError).toContain("hostile");
    }

    expect(byId["evil.module.boom"]).toMatchObject({ namespace: "evil", key: "module.boom" });
  });

  it("ISOLATES a registration MAP KEY whose own toString throws, instead of killing the list", async () => {
    const hostileKey = {
      toString() {
        throw new Error("hostile map key");
      }
    };
    const registry = createRegistry([CORE_TIME]);
    registry.set(
      /** @type {any} */ (hostileKey),
      /** @type {any} */ ({ namespace: "evil", key: "k", scope: "world" })
    );
    setupGame({ registry });

    const response = await router.route(createRequest("setting.list"));

    expect(response.ok).toBe(true);
    expect(response.result.total).toBe(2);
    const byId = Object.fromEntries(response.result.settings.map((row) => [row.id, row]));
    expect(byId["core.time"]).toMatchObject({ type: { kind: "NumberField" } });

    expect(byId["(unreadable key)"]).toMatchObject({
      id: "(unreadable key)",
      key: null,
      unaddressable: true,
      scope: "world"
    });
    expect(byId["(unreadable key)"]).not.toHaveProperty("metadataReadFailed");
  });

  it("addresses a row by the pair that RESOLVES: the record's own when it recombines, else the first-dot split", async () => {
    const registry = createRegistry([
      { id: "pkg.flag", namespace: "pkg", key: "other", scope: "world" },

      { id: "a.b.c", namespace: "a.b", key: "c", scope: "world" },

      { id: "weird", namespace: "weird", key: "", scope: "world" },
      { id: "trailing.", namespace: "trailing", key: "", scope: "world" },
      { id: ".leading", namespace: "", key: "leading", scope: "world" }
    ]);

    const coercedKey = {
      toString() {
        return "evil.k";
      }
    };
    registry.set(
      /** @type {any} */ (coercedKey),
      /** @type {any} */ ({ namespace: "evil", key: "k", scope: "world" })
    );

    registry.set("broken.record", /** @type {any} */ (null));

    registry.set("broken.falsy", /** @type {any} */ (""));
    setupGame({ registry });

    const byId = Object.fromEntries(
      (await router.route(createRequest("setting.list"))).result.settings.map((row) => [row.id, row])
    );
    expect(byId["pkg.flag"]).toMatchObject({ namespace: "pkg", key: "flag" });
    expect(byId["a.b.c"]).toMatchObject({ namespace: "a.b", key: "c" });

    expect(byId.weird).toMatchObject({ namespace: "weird", key: null, id: "weird", unaddressable: true });
    expect(byId["trailing."]).toMatchObject({ namespace: "trailing", key: null, unaddressable: true });
    expect(byId[".leading"]).toMatchObject({ namespace: null, key: "leading", unaddressable: true });

    expect(byId["evil.k"]).toMatchObject({
      id: "evil.k",
      namespace: "evil.k",
      key: null,
      unaddressable: true,
      scope: "world"
    });
    expect(byId["evil.k"]).not.toHaveProperty("metadataReadFailed");

    expect(byId["broken.record"]).toMatchObject({
      id: "broken.record",
      namespace: "broken",
      key: null,
      unaddressable: true,
      scope: null,
      type: null,
      config: false
    });
    expect(byId["broken.record"]).not.toHaveProperty("metadataReadFailed");
    expect(byId["broken.falsy"]).toMatchObject({ namespace: "broken", key: null, unaddressable: true });

    for (const key of ["record", "falsy"]) {
      const brokenGet = await router.route(createRequest("setting.get", { namespace: "broken", key }));
      expect(brokenGet.ok).toBe(false);

      expect(brokenGet.error.code).toBe(ERROR_CODES.SETTING_NOT_FOUND);
    }

    expect(byId["pkg.flag"]).not.toHaveProperty("unaddressable");
    expect(byId["a.b.c"]).not.toHaveProperty("unaddressable");

    expect(byId["pkg.flag"]).not.toHaveProperty("metadataReadFailed");
    expect(byId["a.b.c"]).not.toHaveProperty("metadataReadFailed");

    let unaddressableCount = 0;
    for (const row of Object.values(byId)) {
      if (row.unaddressable) {
        unaddressableCount += 1;
        expect(
          typeof row.namespace === "string" &&
            row.namespace !== "" &&
            typeof row.key === "string" &&
            row.key !== ""
        ).toBe(false);
        continue;
      }

      const response = await router.route(
        createRequest("setting.get", { namespace: row.namespace, key: row.key })
      );
      expect(response.ok).toBe(true);
      expect(response.result.setting.id).toBe(row.id);
    }

    expect(unaddressableCount).toBe(6);
  });

  it("an unaddressable row still SORTS deterministically (a null pair half is never compared directly)", async () => {
    const rows = [
      { id: "pkg.", namespace: "pkg", key: "", scope: "world" },
      { id: "pkg.a", namespace: "pkg", key: "a", scope: "world" },
      { id: "pkg.b", namespace: "pkg", key: "b", scope: "world" }
    ];
    setupGame({ registry: createRegistry(rows) });
    const forward = (await router.route(createRequest("setting.list"))).result.settings.map((row) => row.id);
    setupGame({ registry: createRegistry([...rows].reverse()) });
    const reverse = (await router.route(createRequest("setting.list"))).result.settings.map((row) => row.id);
    expect(forward).toEqual(["pkg.", "pkg.a", "pkg.b"]);
    expect(reverse).toEqual(forward);
  });

  it("REDACTS the bridge's own daemon token on both verbs, and only that key", async () => {
    const tokenId = `${MODULE_ID}.${MODULE_SETTING_KEYS.AUTH_TOKEN}`;
    const tokenRow = {
      id: tokenId,
      namespace: MODULE_ID,
      key: MODULE_SETTING_KEYS.AUTH_TOKEN,
      name: "Daemon Session Token",
      scope: "world",
      config: true,
      requiresReload: true,
      type: String,
      default: ""
    };
    const urlRow = {
      id: `${MODULE_ID}.${MODULE_SETTING_KEYS.DAEMON_URL}`,
      namespace: MODULE_ID,
      key: MODULE_SETTING_KEYS.DAEMON_URL,
      name: "Daemon URL",
      scope: "world",
      config: true,
      type: String,
      default: ""
    };
    const get = vi.fn(() => "tok_live_do_not_leak_me");
    setupGame({ registry: createRegistry([tokenRow, urlRow, CORE_TOKEN_DRAG]), get });

    const rows = (await router.route(createRequest("setting.list"))).result.settings;
    const listed = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(listed[tokenId]).toBeDefined();

    expect(listed[tokenId].valueRedacted).toBe(true);

    expect(listed[tokenId]).not.toHaveProperty("value");

    expect(listed[`${MODULE_ID}.${MODULE_SETTING_KEYS.DAEMON_URL}`]).not.toHaveProperty("valueRedacted");
    expect(listed["core.tokenDragPreview"]).not.toHaveProperty("valueRedacted");

    const redacted = await router.route(
      createRequest("setting.get", { namespace: MODULE_ID, key: MODULE_SETTING_KEYS.AUTH_TOKEN })
    );
    expect(redacted.ok).toBe(true);
    expect(redacted.result.setting.value).toBeNull();
    expect(redacted.result.setting.valueRedacted).toBe(true);

    expect(redacted.result.setting).toMatchObject({
      namespace: MODULE_ID,
      scope: "world",
      type: { kind: "String" }
    });

    expect(get).not.toHaveBeenCalledWith(MODULE_ID, MODULE_SETTING_KEYS.AUTH_TOKEN);

    expect(JSON.stringify(redacted)).not.toContain("tok_live_do_not_leak_me");

    const readable = await router.route(
      createRequest("setting.get", { namespace: MODULE_ID, key: MODULE_SETTING_KEYS.DAEMON_URL })
    );
    expect(readable.ok).toBe(true);
    expect(readable.result.setting.value).toBe("tok_live_do_not_leak_me");
    expect(readable.result.setting).not.toHaveProperty("valueRedacted");
  });

  it("a hostile throw whose OWN description throws degrades ONE row, and keeps SETTING_READ_FAILED", async () => {
    const hostileToString = () => ({
      toString() {
        throw new Error("nested boom");
      }
    });

    const hostileMessage = () =>
      Object.defineProperty(new Error(), "message", {
        get() {
          throw new Error("nested boom");
        },
        configurable: true
      });

    for (const makeThrown of [hostileToString, hostileMessage]) {
      setupGame({
        registry: createRegistry([
          CORE_TIME,
          {
            id: "evil.nested",
            namespace: "evil",
            key: "nested",
            scope: "world",
            get name() {
              throw makeThrown();
            }
          }
        ])
      });

      const list = await router.route(createRequest("setting.list"));
      expect(list.ok).toBe(true);
      expect(list.result.total).toBe(2);
      const byId = Object.fromEntries(list.result.settings.map((row) => [row.id, row]));

      expect(byId["core.time"]).toMatchObject({ type: { kind: "NumberField" } });
      expect(byId["evil.nested"]).toMatchObject({
        metadataReadFailed: true,
        metadataReadError: "unreadable error value"
      });

      setupGame({
        registry: createRegistry([CORE_TOKEN_DRAG]),
        get: () => {
          throw makeThrown();
        }
      });
      const read = await router.route(
        createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
      );
      expect(read.ok).toBe(false);
      expect(read.error.code).toBe(ERROR_CODES.SETTING_READ_FAILED);
      expect(read.error.details).toMatchObject({
        id: "core.tokenDragPreview",
        message: "unreadable error value"
      });
    }
  });

  it("a throwing message getter that RETURNS a non-string is still described as a string", async () => {
    const weirdError = () =>
      Object.defineProperty(new Error(), "message", {
        get() {
          return { not: "a string" };
        },
        configurable: true
      });
    setupGame({
      registry: createRegistry([
        {
          id: "evil.weird",
          namespace: "evil",
          key: "weird",
          scope: "world",
          get name() {
            throw weirdError();
          }
        }
      ])
    });
    const row = (await router.route(createRequest("setting.list"))).result.settings[0];
    expect(row.metadataReadError).toBe("unreadable error value");
  });

  it("CAPS the foreign metadataReadError text and keeps its head", async () => {
    setupGame({
      registry: createRegistry([
        {
          id: "evil.big",
          namespace: "evil",
          key: "big",
          scope: "world",
          get name() {
            throw new Error(`hostile ${"x".repeat(5000)}`);
          }
        }
      ])
    });
    const capped = (await router.route(createRequest("setting.list"))).result.settings[0];
    expect(capped.metadataReadFailed).toBe(true);
    expect(capped.metadataReadError).toHaveLength(200);
    expect(capped.metadataReadError.startsWith("hostile ")).toBe(true);
    expect(capped.metadataReadError.endsWith("…")).toBe(true);

    setupGame({
      registry: createRegistry([
        {
          id: "evil.small",
          namespace: "evil",
          key: "small",
          scope: "world",
          get name() {
            throw new Error("hostile getter");
          }
        }
      ])
    });
    const verbatim = (await router.route(createRequest("setting.list"))).result.settings[0];
    expect(verbatim.metadataReadError).toBe("hostile getter");
  });

  it("setting.get returns one value plus the SAME metadata, and asks Foundry for the caller's pair", async () => {
    const get = vi.fn(() => ({ enabled: true, tags: new Set(["a", "b"]) }));
    setupGame({ registry: createRegistry([MODULE_API_KEY, CORE_TOKEN_DRAG]), get });
    const response = await router.route(
      createRequest("setting.get", { namespace: "my-module", key: "apiKey" })
    );
    expect(response.ok).toBe(true);
    expect(get).toHaveBeenCalledWith("my-module", "apiKey");
    expect(response.result.setting).toMatchObject({
      namespace: "my-module",
      key: "apiKey",
      id: "my-module.apiKey",
      name: "MODULE.ApiKeyName",
      nameLocalized: "API Key",
      scope: "world",
      type: { kind: "String" },

      value: { enabled: true, tags: ["a", "b"] }
    });

    expect(Object.keys(response.result.setting).sort()).toEqual([
      "config",
      "hint",
      "hintLocalized",
      "id",
      "key",
      "name",
      "nameLocalized",
      "namespace",
      "requiresReload",
      "scope",
      "type",
      "value"
    ]);
  });

  it("reports an ABSENT value as null with an IDENTICAL shape to a real value", async () => {
    setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]), get: () => undefined });
    const absent = (
      await router.route(createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" }))
    ).result.setting;
    expect(absent.value).toBeNull();

    setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]), get: () => false });
    const real = (
      await router.route(createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" }))
    ).result.setting;
    expect(real.value).toBe(false);

    expect(Object.keys(absent)).toEqual(Object.keys(real));
  });

  it("setting.get on a HOSTILE registration still returns the value, with the metadata NULLED as a row", async () => {
    const hostile = {
      id: "evil.k",
      namespace: "evil",
      key: "k",
      scope: "world",
      type: Boolean,
      get name() {
        throw new Error(`hostile ${"x".repeat(5000)}`);
      }
    };
    setupGame({ registry: createRegistry([hostile]), get: () => ({ token: "s3cret" }) });
    const response = await router.route(createRequest("setting.get", { namespace: "evil", key: "k" }));
    expect(response.ok).toBe(true);
    const setting = response.result.setting;

    expect(setting).toMatchObject({
      namespace: "evil",
      key: "k",
      id: "evil.k",
      name: null,
      nameLocalized: null,
      hint: null,
      hintLocalized: null,
      scope: null,
      type: null,
      config: false,
      requiresReload: false,
      metadataReadFailed: true,
      value: { token: "s3cret" }
    });
    expect(setting.metadataReadError).toContain("hostile");

    expect(setting.metadataReadError).toHaveLength(200);
    expect(setting.metadataReadError.endsWith("…")).toBe(true);

    expect(Object.keys(setting).sort()).toEqual([
      "config",
      "hint",
      "hintLocalized",
      "id",
      "key",
      "metadataReadError",
      "metadataReadFailed",
      "name",
      "nameLocalized",
      "namespace",
      "requiresReload",
      "scope",
      "type",
      "value"
    ]);
  });

  it("setting.get on an UNREGISTERED key → SETTING_NOT_FOUND naming the disabled-module case", async () => {
    setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]) });
    const response = await router.route(
      createRequest("setting.get", { namespace: "gone-module", key: "apiKey" })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.SETTING_NOT_FOUND);
    expect(response.error.message).toContain("setting list");

    expect(response.error.message).toMatch(/DISABLED or UNINSTALLED/);
    expect(response.error.details).toMatchObject({
      namespace: "gone-module",
      key: "apiKey",
      id: "gone-module.apiKey"
    });
  });

  it("a THROWING Foundry read → SETTING_READ_FAILED carrying the raw message", async () => {
    setupGame({
      registry: createRegistry([CORE_TOKEN_DRAG]),
      get: () => {
        throw new Error("boom from user type");
      }
    });
    const response = await router.route(
      createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.SETTING_READ_FAILED);
    expect(response.error.details).toMatchObject({
      id: "core.tokenDragPreview",
      message: "boom from user type"
    });
  });

  it("keeps the three codes DISCRIMINATING: a walk failure is never SETTING_READ_FAILED", async () => {
    setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]), get: () => ({ token: 42n }) });
    const notSerializable = await router.route(
      createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
    );
    expect(notSerializable.ok).toBe(false);
    expect(notSerializable.error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(notSerializable.error.details).toMatchObject({ reason: "bigint", path: "$.token" });

    setupGame({
      registry: createRegistry([CORE_TOKEN_DRAG]),
      get: () => ({ blob: "z".repeat(300 * 1024) })
    });
    const tooLarge = await router.route(
      createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
    );
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(tooLarge.error.details).toMatchObject({ limit: "value-bytes" });
  });

  it("a DataModel whose SOURCE read throws is SETTING_VALUE_NOT_SERIALIZABLE, never INTERNAL_ERROR", async () => {
    const previousFoundry = globalThis.foundry;
    try {
      class DataModel {
        toObject() {
          throw new Error(
            "Maximum depth exceeded. Be sure your object does not contain cyclical data structures."
          );
        }
      }

      globalThis.foundry = /** @type {any} */ ({ abstract: { DataModel } });
      setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]), get: () => new DataModel() });
      const response = await router.route(
        createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
      expect(response.error.details).toMatchObject({ reason: "data-model-read", path: "$" });

      expect(JSON.stringify(response.error)).not.toContain("Maximum depth exceeded");
    } finally {
      globalThis.foundry = previousFoundry;
    }
  });

  it("guard order: a missing registration map is BRIDGE_NOT_READY, before any key resolution", async () => {
    setupGame({ registry: undefined });
    for (const request of [
      createRequest("setting.list"),
      createRequest("setting.get", { namespace: "core", key: "tokenDragPreview" })
    ]) {
      const response = await router.route(request);
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.BRIDGE_NOT_READY);
    }
  });

  it("neither verb is a write (no GM-write gate, no idempotency, no dryRun)", async () => {
    setupGame({ registry: createRegistry([CORE_TOKEN_DRAG]) });
    for (const command of ["setting.list", "setting.get"]) {
      expect(COMMAND_DEFINITIONS[command].mutation).toBe(false);
    }

    const rejected = await router.route(
      createRequest("setting.get", { namespace: "core", key: "tokenDragPreview", dryRun: true })
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });
});

describe("settings state in the fake Foundry", () => {
  let router;

  beforeEach(() => {
    installFakeFoundry();
    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  afterEach(() => {
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it("serves a registration default until a value is written, then serves the written value", async () => {
    globalThis.game.settings.register("test-module", "mode", {
      scope: "client",
      config: false,
      type: String,
      default: "allow"
    });

    expect(globalThis.game.settings.get("test-module", "mode")).toBe("allow");

    await globalThis.game.settings.set("test-module", "mode", "deny");

    expect(globalThis.game.settings.get("test-module", "mode")).toBe("deny");
    expect(globalThis.__routerTestState.settingValues.get("test-module.mode")).toBe("deny");
  });

  it("returns an empty string for a pair no package registered", () => {
    expect(globalThis.game.settings.get("test-module", "unknown")).toBe("");
  });

  it("serves a seeded value for a pair no package registered", () => {
    globalThis.__routerTestState.settingValues.set("core.noCanvas", true);

    expect(globalThis.game.settings.get("core", "noCanvas")).toBe(true);
  });

  it("registers into the map the setting read commands walk", async () => {
    globalThis.game.settings.register("test-module", "mode", {
      name: "Mode",
      hint: "How the module behaves",
      scope: "client",
      config: false,
      requiresReload: true,
      type: String,
      default: "allow"
    });
    await globalThis.game.settings.set("test-module", "mode", "deny");

    const list = await router.route(createRequest("setting.list"));
    expect(list.ok).toBe(true);
    expect(list.result.settings.find((row) => row.id === "test-module.mode")).toEqual({
      namespace: "test-module",
      key: "mode",
      id: "test-module.mode",
      name: "Mode",
      nameLocalized: "Mode",
      hint: "How the module behaves",
      hintLocalized: "How the module behaves",
      scope: "client",
      type: { kind: "String" },
      config: false,
      requiresReload: true
    });

    const read = await router.route(createRequest("setting.get", { namespace: "test-module", key: "mode" }));
    expect(read.ok).toBe(true);
    expect(read.result.setting.id).toBe("test-module.mode");
    expect(read.result.setting.value).toBe("deny");
  });
});
