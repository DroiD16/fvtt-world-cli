# Foundry compatibility

The bridge supports Foundry VTT v13 and v14. It capability-checks behavior whose availability or
semantics differ by version and returns a structured error when it cannot provide the documented
result honestly.

## Operator contract

- `fvtt-world-cli system info --json` reports the connected Foundry, system, module, limits, and
  discoverable command inventory.
- `UNSUPPORTED_OPERATION` is a capability result, not a transient transport failure.
- A dry run validates a proposed mutation, but values that require execution are not a forecast.

## Known differences

| Area | v13 | v14 | CLI behavior |
|---|---|---|---|
| Measured templates | Available | Removed from core | Template commands are capability-gated |
| Scene thumbnail rendering | Whole-scene behavior | Initial-level behavior | Reports the dimensions and stored path actually produced |
| Scene thumbnail files | Stable scene-based filename | Content-derived filenames | Consumers use the returned path; cleanup policy differs |
| Scene placeable fields | Older document models | Some families add fields | Open-family writes pass through sanitized data; reads expose the documented projection |
| Region behaviors | Core v13 type set | Additional core types | Executable core behavior types remain guarded; other types are Foundry-validated |
| Combat and action APIs | Version-specific signatures | Version-specific signatures | The bridge adapts known signatures and refuses unsupported behavior |

This table describes current operator-visible differences, not implementation evidence. Exact
capabilities remain defined by the connected bridge and exercised by live smoke tests.
