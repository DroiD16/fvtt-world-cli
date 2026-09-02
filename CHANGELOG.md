# Changelog

All notable user-visible changes to fvtt-world-cli will be recorded in this file.

## [1.1.1] - 2026-09-02

- Skill updates work again. The refresh used to run from an npm install script, and npm
  blocks those by default, so it never ran. Now the daemon refreshes installed copies of
  the `foundry-world-editor` skill when it starts.
- If no copy of the skill is installed, the daemon says so and prints the install command.

## [1.1.0] - 2026-09-01

This release puts the GM in charge of what an agent may do. Every command now runs under a
per-command permission policy with an approval flow inside Foundry. The new commands can execute
macros, write settings, manage users, and push content to players, so they ship disabled or behind
approval until a human turns them on.

### Command permissions and GM approval

- Every command has one of three behaviors in the GM client that holds the bridge: allow, approve,
  or deny. The GM edits them in the new Command permissions window under Module Settings. The
  policy belongs to that browser profile, so different machines can hold different policies.
- A command set to approve holds until the GM decides. Foundry opens a Command Approval window
  with the command, the documents it would touch, and the values it would write, and plays a
  notification sound. The sound and the approval timeout are settings.
- Command discovery now describes what the connected GM client will actually run. The listing
  hides denied commands and marks approval waits in both plain and JSON output. A denied command
  refuses to run even as a dry run.
- The default policy sorts commands by what a mistake would cost. Reads and ordinary edits run on
  their own. Destructive commands, such as deleting documents, moving files, and resetting scene
  fog, wait for approval, so after the update a script can no longer delete content without a GM
  saying yes. The new high-risk commands are denied until a GM enables them.

### New commands

- `macro execute` runs a world macro with named arguments and a bounded timeout, then reports the
  return value and the chat messages the run created. A script macro that throws fails the
  command, and the error names what the macro raised. Off by default.
- `setting set` and `setting set-many` write world settings and report the value Foundry actually
  stored. `setting get-many` batch-reads settings and flags unknown keys per row. Writes are off
  by default.
- `user create`, `user update`, `user delete`, `user role set`, and `user permissions set` manage
  users from the CLI. Role and permission changes are off by default. Creating a user asks for
  approval.
- `scene region behavior executable create`, `update`, and `clone` author executeMacro region
  behaviors through a dedicated family with its own payload guards. Off by default.
- Player-facing actions: `scene activate`, `scene pull-users`, `journal show`, `image show`,
  `game pause`, `system reload`, and `chat flush`. A broadcast aimed at specific users reports who
  was offline. `system reload` and `chat flush` ask for approval by default.

### Security

- Managed file path checks now reject percent-encoded traversal. An encoded `..` segment or an
  encoded path separator inside a segment used to survive until after the boundary check.

### Fixes and other changes

- The CLI on your machine and the Foundry module now work only as a matched pair from the same
  release. A mixed pair refuses to connect, and the error says which side is behind, so update
  both together.
- The packaged `foundry-world-editor` Agent Skill is updated for the permission and approval flow
  and the new commands.
- Retries are more careful: when the bridge cannot prove a retry is the same request it already
  handled, it refuses it rather than risk running the command twice.
- A managed file listing no longer fails on an entry it cannot represent, and it names the managed
  data root it addresses.
- Only GM users see the module's settings.

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
