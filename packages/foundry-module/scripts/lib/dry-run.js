/**
 * @param {{ dryRun?: unknown }} [params]
 * @returns {boolean}
 */
export function isDryRun(params) {
  return params?.dryRun === true;
}

/**
 * @param {Record<string, unknown>} base
 * @returns {Record<string, unknown> & { dryRun: true }}
 */
export function dryRunResponse(base) {
  return { ...base, dryRun: true };
}
