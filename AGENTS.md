# AGENTS.md

## Product

fvtt-world-cli is a local-first automation stack for FoundryVTT: a safe CLI, a local authenticated
daemon, and a Foundry bridge module that let a human or AI agent inspect and edit world content
through Foundry's own APIs, without brittle browser automation or direct mutation of live world
files.

## Product Principles

- Provide a stable command surface for common world-editing tasks.
- Keep the transport local and authenticated by default.
- Execute content mutations through Foundry's Document APIs.
- Return machine-readable results suitable for safe agent use.
- Support dry-run, audit, and predictable errors.

## Non-Goals

- No arbitrary JavaScript execution from the CLI.
- No direct writes into live Foundry world data.
- No arbitrary reads or writes outside Foundry's managed `data` file source.
- No browser UI automation as the primary control path.
- No public internet-exposed API.
- No universal cross-type "edit anything" primitive. Each document family has an explicit schema and
  write policy.

## Repository and Runtime Boundaries

Keep the CLI, protocol, and Foundry module in this monorepo so their contracts evolve together.

- `packages/protocol` owns command names, request schemas, result types, constants, and error codes.
- `packages/cli` owns the user-facing CLI, local daemon, configuration, transport, and output.
- `packages/foundry-module` owns Foundry-side validation, serialization, capability checks, and
  execution through Foundry APIs.
- The daemon owns loopback routing, credential authentication, the pairing registry, and active
  bridge-session state.
- The bridge assumes an authenticated GM client is open in Foundry.
- Keep the transport bound to loopback and authenticated by default.
- Preserve the tested terminal-stop and reconnect semantics. Changes to the handshake or connection
  state machine require matching transport tests and protocol documentation.
- Git-tracked files must remain machine-independent and must not contain machine-specific absolute
  paths or references to local files or directories outside the repository. Keep such paths and setup
  notes in ignored local files or under `.local/`; use repository-relative paths and placeholders in
  tracked files.

## Code Style

One style across the packages. Follow it in new code and converge existing code toward it when
touching it for another reason.

1. Formatting is mechanical, not judgment: Prettier with the checked-in `.prettierrc.json` and
   `.prettierignore`, enforced by `npm run format:check` at the head of the `test` script. The
   config is the authority; do not restate its options elsewhere or hand-format around it.
2. ESM with named exports only. Default exports belong in tool config files that require them, such
   as `vitest.config.js`, and nowhere else.
3. Factories over classes for handler maps and other stateless groupings (`create*Handlers()`).
   Classes are for genuinely stateful long-lived objects — such as `BridgeDaemon` or
   `BridgeSessionStore` — and for error types.
4. Implementation code stays comment-free per Implementation Comments below; JSDoc carries only the
   tags the type checker needs.
5. Errors by layer: `createBridgeError` for Foundry-module failures, `createProtocolError` for
   protocol envelopes, `DaemonTransportError` for CLI transport failures, Commander's
   `CommanderError`/`InvalidArgumentError` for CLI parsing and control flow, and native `Error` only
   for states that cannot occur.
6. Long agent-facing remediation prose in an error message is a product feature; tests pin the
   code, the `details` object, and one distinctive token, not the message prose.
7. No handler mutates its `params`; derive new locals instead.
8. Registry entries carry no derivable or dead fields.
9. Commander actions take a named option interface, and a family's shared flags are declared once.
10. Test names describe behavior. Process history — stages, chunks, review rounds — belongs in no
    durable artifact: test names, commit messages, or release notes.

## Implementation Comments

Keep implementation code comment-free. Add a comment only when it is strictly necessary to prevent
an incorrect future modification; keep it minimal and explain the non-obvious invariant or reason,
not the code's mechanics.

Minimal JSDoc annotations required for JavaScript static type checking are allowed. Keep only the
type-bearing tags and omit explanatory prose that does not affect the type checker.

Vendored dependencies and byte-faithful upstream sources are exempt from the default comment policy.
Preserve their comments exactly as received; do not add, rewrite, or remove comments in those files.

## Safety and Schema Invariants

These are product constraints. Preserve them when adding commands or document families.

- World-document families and closed embedded families use closed protocol schemas
  (`additionalProperties:false`). Their enumerated field sets reject unknown top-level fields and
  protected document metadata such as `_id`, `_stats`, and raw `ownership`.
- Scene-embedded documents, ActiveEffects, RegionBehaviors, and any other explicitly open family may
  use passthrough schemas so Foundry can validate system/module data. Every write and preview path for
  an open schema must use the shared sanitizer for protected metadata and server-controlled authorship
  before validation, diffing, or dispatch.
- `ownership` is access policy, not ordinary content. Raw ownership remains outside normal
  create/update payloads; supported ownership changes use dedicated GM-gated commands.
- CLI-supplied data must not create an arbitrary-code execution path. Keep executable RegionBehavior
  types blocked through the shared guard on every write route.
- Report mutation success only after confirming that Foundry accepted the requested state.
  Capability-gate unsupported or version-dependent behavior, and preserve legitimate no-op results.
- Dry runs execute the same schema validation, sanitization, capability checks, security guards, and
  preparation logic as real calls. They stop before mutation and report only outcomes knowable at
  preview time.
- Bulk commands are envelopes over existing family behavior. Each element must reuse the corresponding
  single-command preparation and guards.
- Reads and write results serialize stored, authored state; derived values must be explicitly
  identified.
- Requests and responses remain versioned and correlated by request id. Errors remain structured and
  stable, and commands use explicit typed names rather than a generic RPC.
- Tests or documentation that claim complete command or family coverage must derive that set from the
  protocol registry rather than maintain a parallel list.

## Managed File Safety

The file command surface is limited to managed Foundry assets. These are implementation invariants
of the file commands; preserve them in every write and preview path.

- File operations are hard-pinned to Foundry's managed `data` source and normalized relative paths.
- Writes are restricted to the active world's `worlds/<worldId>/` tree and always reject that
  world's `world.json`, `data/**`, and `packs/**`. Containment and deny-list checks stay
  segment-aware, including encoded path spellings.
- The active-world boundary is resolved and validated before capability checks or payload decoding.
- File operations use stable public Foundry APIs and return `UNSUPPORTED_OPERATION` when no
  supported primitive exists.
- Upload content crosses the local transport as data; the Foundry module accepts only managed
  data-relative destinations.
- A file operation never rewrites document references; that is a separate explicit document command.
- Any expansion of the file boundary requires security review, regression tests, and updates to
  `docs/security.md`, `docs/protocol.md`, and `docs/commands.md`.

## Sources of Truth

Keep this file limited to stable product, safety, workflow, and repository instructions. Protocol
details belong in code and tests, user-visible behavior in documentation, and investigation history
in repository-scoped memory or version control.

- `packages/protocol/src/commands.js`: normative command registry, assembled from the family
  modules, plus the transport message schemas
- `packages/protocol/src/schemas/`: per-family command names and request schemas
- `packages/protocol/src/constants.js`: shared constants and error codes
- `packages/protocol/tests/protocol.test.js`: exhaustive protocol invariants
- `packages/foundry-module/scripts/lib/` and `packages/foundry-module/scripts/handlers/`: runtime
  preparation, sanitization, capability, confirmation, and dispatch behavior
- `packages/foundry-module/tests/`: runtime and regression contracts
- `scripts/live-smoke.mjs`: live coverage and cleanup behavior
- `scripts/build-release-artifacts.mjs`: release artifact assembly and version-consistency checks
- `docs/commands.md`: user-facing command behavior
- `docs/protocol.md`: wire protocol and result shapes
- `docs/security.md`: trust boundaries, permissions, and security rationale
- `docs/architecture.md`: architectural rationale and supported-version design
- `skills/foundry-world-editor/SKILL.md`: operating workflow for AI-agent consumers, distributed as
  an installable Agent Skill
- `docs/skill.md`: user-facing skill lifecycle reference (installing, updating, removing)
- `docs/compatibility.md`: operator-visible differences between supported Foundry versions

Keep durable Foundry-version discoveries in the repository-scoped basic-memory project when useful to
future investigations. Keep release history in release notes or version control. Promote a discovery
into this file only when it becomes a stable instruction that changes how future work must be performed.

## Documentation Maintenance Policy

Behavioral changes require documentation review and any necessary updates in the same change.

- Command names, parameters, results, or examples: update `docs/commands.md` and
  `docs/protocol.md`.
- Consumer workflow guidance (discovery, preview, retry, verification): update
  `skills/foundry-world-editor/SKILL.md`.
- Skill installation, update, or removal behavior: update `docs/skill.md`.
- Version-dependent capabilities or capability gates: update `docs/compatibility.md`, keeping it
  limited to differences users or contributors must act on.
- Authentication, transport, permissions, or trust boundaries: update `docs/security.md` and
  `docs/architecture.md`.
- Setup or packaging: update `README.md` and `docs/getting-started.md`.
- Adding, removing, or repurposing a document: update the map in `docs/README.md`.

Treat stale documentation as a bug.

## Commit Policy

Use an English commit subject in the form `type: summary`.

- Allowed types are `add`, `fix`, `chg`, `docs`, `chore`, `release`, `merge`, and `revert`. Choose the
  type by the primary purpose of the commit:
  - `add`: introduce a new user-visible capability;
  - `fix`: correct defective behavior;
  - `chg`: change existing behavior or implementation, including refactoring and performance work;
  - `docs`: change only documentation;
  - `chore`: maintain tests, dependencies, tooling, builds, or CI without changing product behavior;
  - `release`: prepare release metadata;
  - `merge`: integrate an intentionally merged line of work;
  - `revert`: reverse an earlier commit.
- Keep the entire subject at 90 characters or fewer. Use an imperative, concise summary without a
  trailing period. Do not include a version except in a `release` commit.
- Use `merge: summary` for an intentionally authored merge commit and `release: x.y.z` for a release
  commit. Do not repeat branch names when the summary already identifies the merged work.
- Add a body only when the motivation, user-visible consequence, compatibility impact, migration, or
  non-obvious verification would otherwise be lost. Prefer one to three short paragraphs that explain
  why the change was needed and what constraint matters; do not narrate the diff.
- Keep investigation transcripts, exhaustive defect lists, review history, and test matrices out of
  commit messages.
- Keep commits cohesive. Do not mix unrelated cleanup, documentation, refactoring, or behavior changes
  merely to reduce the number of commits.

## Development Workflow

- Implement a substantive feature in its own branch. Small, self-contained fixes and maintenance work
  do not require a dedicated branch.
- Complete the feature, its proportionate tests, and required documentation before merging it into
  `main`.
- Merge completed feature branches into `main` with a merge commit; do not use fast-forward merges.
- After verifying that the merge is complete and the branch contains no unmerged work, the feature
  branch may be deleted.

## Release Naming and Changelog Policy

Treat a release as a separately approved operation. Before changing version metadata, creating a tag,
or publishing artifacts, agree with the user on the release scope, exact version, and final changelog.

- Use three-component Semantic Versioning (`x.y.z`). Fix-only releases increment `z`; backward-
  compatible features or user-visible behavior changes increment `y` and reset `z`; breaking changes
  increment `x` and reset the remaining components. While the product is `0.y.z`, use a minor bump for
  breaking changes and call them out explicitly in the changelog.
- Use the bare version as both the Git tag and release title, for example `0.16.0`. Release commits, when
  requested, are named `release: 0.16.0`. Do not add codenames or marketing subtitles.
- This monorepo uses one fixed product version across the root package, all workspace packages, the
  Foundry module manifest, internal package dependency pins, and their lockfile entries. Every release
  updates these fields together, even when a component has no direct changes. Determine the release
  version from the highest-impact shipped change across the CLI, protocol, daemon, and Foundry module,
  then package and verify them as one compatible release set.
- Derive the changelog from the complete diff since the previous release tag, not only merge or commit
  subjects. Include only changes that ship in the release.
- Write release notes in English. Keep them short, non-technical, and focused on user outcomes. Group
  related changes under descriptive headings when that improves scanning; omit empty categories.
- Lead each entry with what users can now do, what works better, or what risk was removed. Mention CLI
  commands, configuration keys, protocol details, or internal refactors only when users must act on
  them.
- Call out breaking changes, migrations, changed defaults, compatibility changes, security impact, and
  required operator actions explicitly. State known limitations or unverified Foundry-version coverage
  rather than implying broader validation.
- Do not include commit-by-commit narration, implementation details, issue IDs without useful
  context, or AI-assistant credits.
- Maintain the release history in the root `CHANGELOG.md`, written only at release time: each
  release adds a new `## [x.y.z] - YYYY-MM-DD` section in newest-first order. The body of that
  version section is the canonical release text and must be used byte-for-byte as the GitHub Release
  notes; only the external release title and the changelog's version-and-date heading may differ.
- Preserve published changelog entries as historical records; correct material inaccuracies explicitly
  instead of silently rewriting an old release.
- Publishing, pushing tags, and creating a release require explicit user approval after the final
  version, notes, changelog entry, diff, verification results, and expected artifacts have been
  reviewed.

## Documentation Sources

Use these official Foundry entry points to locate current articles and version-specific API material:

- Knowledge Base and articles: https://foundryvtt.com/kb/
- API reference: https://foundryvtt.com/api/
