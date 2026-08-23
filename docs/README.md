# Documentation

The canonical command is `fvtt-world-cli`. The shorter `worldctl` executable is an equivalent bin
entry for the same CLI and may be used in interactive workflows.

fvtt-world-cli exposes a local, authenticated command line for inspecting and changing a live
Foundry world through Foundry's own APIs.

Authorization uses one-time pairing; the first-run flow is covered in
[Getting started](getting-started.md). Config defaults are `$XDG_CONFIG_HOME/fvtt-world-cli`
or `~/.config/fvtt-world-cli` on Linux, `~/Library/Application Support/fvtt-world-cli` on macOS, and
`%APPDATA%\\fvtt-world-cli` on Windows.

## Choose a route

If you are operating the CLI yourself, start with [Commands](commands.md). It explains what the tool
can do, groups related operations by task, and links to the detailed contracts that matter for each
workflow.

If an AI agent or another program is operating the CLI, install the packaged agent skill into the
agent with `fvtt-world-cli skill install`. The skill carries the operating workflow and defers
command specifics to the CLI's own discovery surface, so agents never rely on a copied command
inventory in prose; [Agent skill](skill.md) explains why it exists and how it is kept current.

## Documentation map

| Document | Audience | Purpose |
|---|---|---|
| [Getting started](getting-started.md) | People | First-run daemon, pairing, and bridge walkthrough |
| [Commands](commands.md) | People | Capabilities, common workflows, shared command behavior, and navigation by task |
| [Agent skill](skill.md) | Agent operators | Why the packaged skill exists, installing it, how updates and removal work |
| [Protocol](protocol.md) | Implementers and automation consumers | Transport, session, delivery, approval, and error semantics — the integration contract |
| [Architecture](architecture.md) | Contributors | Component responsibilities and request flow |
| [Security](security.md) | Operators and contributors | Trust boundaries, permissions, managed files, and known risks |
| [Foundry compatibility](compatibility.md) | Operators and contributors | Current differences between supported Foundry major versions |
| [Changelog](../CHANGELOG.md) | Users and contributors | Versioned history of user-visible changes |

## Finding exact command syntax

The running CLI is the authoritative reference for the installed version:

```bash
fvtt-world-cli commands
fvtt-world-cli commands --json
fvtt-world-cli schema actor.update
fvtt-world-cli actor update --help
fvtt-world-cli docs protocol
```

`commands --json` enumerates the available commands and identifies mutations. `schema` returns the
request schema used by local validation. Command help maps protocol parameters to CLI flags. `docs`
lists and prints these documentation files as shipped with the installed CLI.

## Sources of truth

Documentation explains the public behavior but does not duplicate exhaustive machine-readable
inventories.

- Command names, mutation classification, and request schemas, per family:
  [`packages/protocol/src/schemas/`](../packages/protocol/src/schemas/), assembled into the registry
  by [`packages/protocol/src/commands.js`](../packages/protocol/src/commands.js)
- Shared constants and stable error codes:
  [`packages/protocol/src/constants.js`](../packages/protocol/src/constants.js)
- Global flags, the JSON output contract printed in `--help`, and program assembly:
  [`packages/cli/src/program.ts`](../packages/cli/src/program.ts)
- Per-command flags and command registration, per group:
  [`packages/cli/src/commands/`](../packages/cli/src/commands/)
- Human-readable rendering of command results, per family:
  [`packages/cli/src/render/`](../packages/cli/src/render/)
- Foundry-side behavior: [`packages/foundry-module/scripts/`](../packages/foundry-module/scripts/)
- Live coverage: [`scripts/live-smoke.mjs`](../scripts/live-smoke.mjs)
