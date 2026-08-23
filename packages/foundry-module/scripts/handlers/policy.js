import { buildPolicySnapshot, readStoredCommandPolicy } from "../lib/policy.js";

export function createPolicyHandlers() {
  return {
    async "policy.snapshot"() {
      return buildPolicySnapshot(readStoredCommandPolicy());
    }
  };
}
