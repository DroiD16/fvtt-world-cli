# Changelog

All notable user-visible changes to fvtt-world-cli will be recorded in this file.

## [1.0.0] - 2026-08-18

The first public release. fvtt-world-cli connects an AI agent to a live Foundry VTT world: a local
CLI, an authenticated daemon, and a bridge module that perform every change through Foundry's own
APIs, exactly as a GM would in the UI — no browser automation, no editing world files on disk.

### World editing

- The everyday GM surface is covered: actors and their inventories, items, journals, scenes down to
  individual tokens, walls, lights, and regions, roll tables, playlists, card stacks, combat
  encounters, chat, macros, folders, and active effects.
- Content can be searched across the world and compendiums, imported from compendium packs, and
  organized into folders; ownership changes go through dedicated GM-gated commands.
- Managed world assets can be inspected, uploaded, and audited for broken references, within a
  strict per-world file boundary.

### Built for agents

- Structured JSON output, runtime schema discovery, and a global `--dry-run` preview make the
  command surface safe to automate.
- The packaged `foundry-world-editor` Agent Skill teaches Claude Code, Codex, and other compatible
  agents to drive the CLI; `fvtt-world-cli skill install` manages it and updates keep it current.
- The full documentation ships inside the package and prints via `fvtt-world-cli docs`, so the
  installed CLI is self-describing offline.

### Safety

- Everything stays on your machine: the daemon accepts loopback connections only, and every browser
  pairs once through an explicit approval at the terminal.
- Foundry remains the authority: changes run through its Document APIs and validation under the
  GM's permissions, and there is no arbitrary-code execution path.
- File writes are confined to the active world's managed assets and always exclude its manifest,
  databases, and compendium packs.

### Compatibility

- Supported and verified on Foundry VTT v13 and v14. Version-dependent behavior is capability-gated
  and reported per command.
