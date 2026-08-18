import { createHash } from "node:crypto";

import type { CommandResponseEnvelope } from "../transport-util.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1_000;

interface CacheEntry {
  fingerprint: string;

  responseBody: CommandResponseEnvelope;
  expiresAt: number;
}

export interface IdempotencyMetadata {
  key: string;
  fingerprint: string;
}

export interface IdempotencyCacheOptions {
  ttlMs?: number;
  maxEntries?: number;

  now?: () => number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function computeRequestFingerprint(command: string, params: Record<string, unknown>): string {
  const { idempotencyKey: _idempotencyKey, ...rest } = params;
  const canonical = stableStringify({ command, params: rest });
  return createHash("sha256").update(canonical).digest("hex");
}

export type IdempotencyLookup =
  { status: "miss" } | { status: "hit"; response: CommandResponseEnvelope } | { status: "conflict" };

export class IdempotencyCache {
  ttlMs: number;
  maxEntries: number;
  private now: () => number;

  private entries: Map<string, CacheEntry>;

  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    now = () => Date.now()
  }: IdempotencyCacheOptions = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  lookup(key: string, fingerprint: string): IdempotencyLookup {
    const entry = this.entries.get(key);
    if (!entry) {
      return { status: "miss" };
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { status: "miss" };
    }

    if (entry.fingerprint !== fingerprint) {
      return { status: "conflict" };
    }

    return { status: "hit", response: entry.responseBody };
  }

  store(key: string, fingerprint: string, responseBody: CommandResponseEnvelope) {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      fingerprint,
      responseBody,
      expiresAt: this.now() + this.ttlMs
    });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  storeIfAbsent(key: string, fingerprint: string, responseBody: CommandResponseEnvelope): boolean {
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.expiresAt > this.now()) {
        return false;
      }

      this.entries.delete(key);
    }
    this.store(key, fingerprint, responseBody);
    return true;
  }

  get size() {
    return this.entries.size;
  }

  clear() {
    this.entries.clear();
  }
}

export {
  DEFAULT_TTL_MS as IDEMPOTENCY_DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES as IDEMPOTENCY_DEFAULT_MAX_ENTRIES
};
