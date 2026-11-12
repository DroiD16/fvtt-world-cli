# Changelog

All notable user-visible changes to fvtt-world-cli will be recorded in this file.

## [1.3.0] - 2026-11-12

### New

- Journal pages have their own commands to list, read, create, edit and delete one page at a
  time. Listing pages no longer returns every page body.
- `world references` shows every place in the world that points at a document, so you can check
  before a delete or relink. It covers UUIDs and content links, token actors and other id fields,
  module flags, folders, world and user settings, hotbar slots, and relative links between journal
  pages and roll table results. It also finds an actor's tokens across all scenes. Chat messages
  are searched only on request.
- Actor items can be created, updated and deleted in bulk.
- Every `clone` command accepts `--patch-json` to change fields of the copy.

### Improvements

- `file read` handles files up to the transfer limit (100 MiB by default) instead of 1 MiB.
- A setting value or macro result with a part that has no JSON form, such as a getter or a
  circular reference, now comes back with that part marked and listed. Before, the whole read
  failed.
- Documents that hold a stored Foundry 14 delete or replace operator can be read again.
- Clearer errors for dotted patch keys, uploads the server rejects, and creates that Foundry
  silently drops.
- The agent skill tells agents to reuse a running daemon and to check references before deleting
  a document.

### Changes that affect scripts

- Colours in `--include prepared` reads are `#rrggbb` strings, the form Foundry stores, instead of
  numbers.
- The `SETTING_VALUE_NOT_SERIALIZABLE` error code is removed. Setting reads return a partial value
  instead.

## [1.2.1] - 2026-11-09

- When Foundry stores something other than what was requested, the error now shows both values for
  each field and no longer tells you to disable modules.
- Fixed false "not updated" errors when deleting or replacing fields.
- Setting changes that Foundry or a module altered are now reported instead of passing as success.
- You can see what an unlinked token overrides from its actor and make it follow the actor again.
- Several compendium entries can be read in one call, and reads show where a document was imported
  or duplicated from.

## [1.2.0] - 2026-11-03

Foundry v14 moved scene maps onto levels, and until now a scene created through the CLI there could
not get a map at all. This release adds levels, and common commands return less by default so they
take up less of an agent's context.

### Scene levels on Foundry v14

- A scene can be created together with its levels and their maps, and the new `scene level`
  commands manage the levels of an existing scene.
- Scene results show the levels. Tokens, tiles, walls and other placeables show which levels they
  are on.
- Deleting a level also deletes the tokens and other content that exist only on it. A dry run does
  not list them, so check the scene first.
- The file audit checks the maps of every level.

### Other changes

- Scenes can be put into folders. On v13 the scene background accepts the anchor, fit and alpha
  threshold options.
- `system info` and actor reads leave out optional details by default, which keeps them small. The
  module list and an actor's items come on request with `--include modules` and `--include items`.
- A GM can turn off the warning shown when the daemon is unavailable at world load. A manual
  Connect still warns.

### Fixes

- The daemon no longer overwrites config changes the CLI made while it was running, and saving the
  config no longer brings back an old credential.
- When another program answers on the daemon's address, the CLI says so instead of asking you to
  pair again.
- If the daemon was not running when the world loaded, Foundry now tells the GM to click Connect
  once it is, instead of reloading.

### Before updating

- Update the CLI and the Foundry module together. 1.2.0 refuses to connect to components from
  other releases.
- Scripts that read the following need adjusting:
  - the command list from `system info`, now available from `commands`;
  - actor `items`, now replaced by `itemCount` unless items are requested;
  - on v14, the scene-wide map fields, which have moved into `levels`.
- In `--json` mode, a refused `auth` or `bridge release` now exits with a non-zero code.

## [1.1.2] - 2026-09-07

- Improved result reporting for partially successful changes.
- Fixed incorrect updates of single list elements.
- Fixed macro execution approval: a macro changed after approval no longer runs.
- Documentation was updated for readability.

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
