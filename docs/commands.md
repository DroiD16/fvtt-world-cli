# Commands

`fvtt-world-cli` and its short alias `worldctl` accept the same commands. World operations require
a running daemon and an open, paired GM session; see [Getting started](getting-started.md).

## Finding the right command

```bash
fvtt-world-cli commands --json
fvtt-world-cli schema actor.update
fvtt-world-cli actor update --help
```

`commands` lists available operations, `schema` shows accepted protocol parameters, and `--help`
shows CLI flags. Protocol names use dots; CLI commands use spaces. For example, `scene.token.get`
becomes `scene token get`. Nested commands require the parent IDs as well as the target's ID.

With a bridge connected, discovery omits denied commands and marks approval requirements with
`approval: true`. If the daemon or bridge is unavailable, it returns the static registry with
`policy.applied: false`. Authentication and protocol errors do not trigger that fallback.
`schema` and `--help` always describe the static registry, including denied commands.

## Capability map

Use these families to narrow your search, then check their help for supported operations.

| Task | Command families |
|---|---|
| Edit world content | `actor`, `item`, `journal`, `scene`, `macro`, `playlist`, `table`, `cards` |
| Edit embedded content | Nested families such as `actor.item`, `playlist.sound`, `table.result`, and `*.effect` |
| Edit scene placeables | `scene.token`, `scene.wall`, `scene.region`, and related families |
| Manage encounters | `combat`, `combat.combatant`, `combat.group` |
| Organize content and access | `folder`, `*.ownership.set`, `user` |
| Manage chat and settings | `chat`, `setting` |
| Find content or missing assets | `world.search`, `world.audit-files` |
| Read packs or import world documents | `compendium`, supported `*.import-from-compendium` commands |
| Manage assets | `file` |
| Control playback and gameplay | Actions within `playlist`, `table`, `cards`, `combat`, `scene`, and `game` |
| Show content to players | `scene pull-users`, `journal show`, `image show` |
| Inspect the connection | `system info`, `system ping` |

## Common workflows

### Find, inspect, update, verify

Check the connected world before making changes:

```bash
fvtt-world-cli system info --json
fvtt-world-cli actor list --name "Goblin" --json
fvtt-world-cli actor get --actor-id <id> --json
fvtt-world-cli --dry-run actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor get --actor-id <id> --json
```

### Work with an embedded document

Supply the complete parent ID chain. Read the parent to find missing IDs:

```bash
fvtt-world-cli scene token list --scene-id <sceneId> --json
fvtt-world-cli scene token get --scene-id <sceneId> --token-id <tokenId> --json
```

### Send a batch of commands

Save these lines as `requests.ndjson`:

```jsonl
{"id":"check-bridge","command":"system.ping","params":{}}
{"id":"inspect-world","command":"system.info","params":{}}
```

```bash
fvtt-world-cli exec --stdin < requests.ndjson
```

Requests run in order. Output is NDJSON, with the supplied `id` and zero-based line `index` on each
response. Failures do not stop later requests unless you pass `--stop-on-error`; any failure makes
the process exit non-zero.

## Shared command behavior

### Command permissions and approval

Set allow, approve, or deny under Configure Settings → Module Settings → World CLI → Command
permissions. The policy belongs to the browser profile holding the bridge. The window shows every
command, including those hidden from CLI discovery. See [Security](security.md#permissions-and-destructive-actions)
for default permissions and review limits.

When approval is required, the CLI waits for the GM to answer Foundry's Command Approval window.
Its waiting message goes to stderr, leaving stdout for JSON results.
The *Approval timeout (minutes)* setting controls the deadline.

Ctrl+C requests cancellation. Only `APPROVAL_CANCELLED` proves it succeeded. If execution has
started or cancellation cannot be confirmed, inspect world state before retrying.
[Protocol](protocol.md#delivery-states-and-retries) lists the outcomes and safe next actions.

#### Commands that are off by default

These commands ship with the deny behavior: hidden from discovery and refused, even as dry runs,
until a GM enables them in the Command permissions window. Each one executes code, changes who can
do what, or persists outside the world's own data. Approve is the middle ground: a GM who wants to
review every macro body before it runs sets `macro.execute` to approve rather than allow.

- `macro.execute`
- `setting.set`
- `setting.set-many`
- `user.role.set`
- `user.permissions.set`
- `scene.region.behavior.executable.create`
- `scene.region.behavior.executable.update`
- `scene.region.behavior.executable.clone`

### JSON output

Use `--json` for automation. World commands return `ok: true` with `result`, or `ok: false` with
an `error` containing a code, message, and optional details. Failures exit non-zero. Branch on
`error.code`, not the message text. See the [response examples](protocol.md#request-and-response-example).

Results use command-specific keys such as `actor`, `items`, or `outcomes`. Use returned document
`id` fields to address later commands.

### Reading collections and documents

Paginated commands accept `--limit` and `--offset`. Continue until the response's `hasMore` is false;
`total` describes the matching collection. Supported filters apply before pagination.

List rows contain fewer fields than `get` results. Read the target with `get` before preparing an
update. Reads return authored state; some commands accept `include` options for derived or expensive
data. Check the command's help for available projections and filters.

### Updates and merge semantics

Use JSON flags such as `--data-json` and `--patch-json` for structured values. Updates are patches:

- Nested objects merge recursively.
- Ordinary arrays replace as a whole.
- Dotted paths target object properties where permitted; dotted writes inside arrays are refused.
- Foundry deletion syntax can remove permitted nested keys.
- Embedded collections follow their family's Foundry semantics.

Read arrays before editing and preserve unchanged values. For a wall's `c` field, send the complete
`[x1, y1, x2, y2]`, not `c.0`. Invalid or ambiguous patch shapes return `INVALID_PARAMS` before
mutation, including in bulk writes and dry runs. Correct the fields identified by the error.

Prefer dedicated commands for creating embedded documents. A parent update that adds entries
without `_id`, such as new `behaviors` in `scene.region.update`, can create them but return an
indeterminate error. Inspect the collection before retrying to avoid duplicates.

### Dry run

The global `--dry-run` flag validates and prepares a mutation without writing. Results include
`dryRun: true`. A preview cannot predict execution-dependent effects or reserve world state.

Previews skip approval and report `approvalRequired: true` if the real command would wait.
Denied commands remain denied in previews.

### Failures and retries

A timeout or disconnect can happen after a write commits. An update error with `details.partial`
or `details.indeterminate` can also mean that some changes persisted. Read affected state before
retrying and send only what remains to be done.

An idempotency key identifies one logical request and can prevent duplicate effects while its
cached state survives. Reuse it only for the same request; a corrected or remaining patch is a
new operation and needs a fresh key. Follow the [delivery rules](protocol.md#delivery-states-and-retries)
when a connection fails, since some failures also lose the cached state.

Bulk writes are not transactions. Inspect `complete` and every entry in `outcomes` before deciding
what to retry.

### Actions

`scene pull-users`, `journal show`, and `image show` target every connected player when
`--user-ids` is omitted. Supply a non-empty list to select players. Their results confirm dispatch,
not that a player saw the content.

`macro execute` can leave effects behind after an error, and `MACRO_TIMEOUT` does not stop the
macro. Verify affected state before retrying. See [Executable content](security.md#executable-content)
before enabling macro execution or executable region behaviors.

### File paths

File commands use Foundry's managed `data` source. Writes belong under `worlds/<worldId>/` and
exclude the world's manifest, databases, and packs. Supply literal paths, without pre-encoding
filename characters. Change document references separately after a file operation.
See [File write boundary](security.md#file-write-boundary) for the exact restrictions.

## Authorization commands

These commands require the daemon but no open Foundry browser. Prefix the commands below with
`fvtt-world-cli`.

### Wait for pairing

`auth` waits for the earliest pending pairing request and displays its identity. Start it before
or after clicking *Pair* in Foundry. `y` or `yes` approves; any other answer denies that request.
Ctrl+C or ended input during the prompt leaves it pending.

The wait has no overall deadline; `--timeout-ms` does not set one. If the daemon becomes unavailable,
restart `auth` after restoring it. Bare `auth` requires an interactive terminal. Scripts should
inspect `auth pending`, then use `auth approve <code> --yes` for the selected request.

### Manage pairings and connections

| Command | Effect |
|---|---|
| `auth status` | Show bridge state and public profile metadata |
| `auth pending` | List pending codes, expiry, and browser/world/GM identity |
| `auth approve [code] [--yes]` | Approve a selected request; omit the code only when exactly one is pending |
| `auth deny <code>` | Reject a pending request |
| `auth list` | List paired browsers and their last-seen times |
| `auth prune [--older-than <days>] [--yes]` | Remove idle pairings, defaulting to 30 days |
| `auth revoke <pairingId>` | Delete a pairing and disconnect it if active |
| `auth rotate-client --yes` | Replace the local CLI credential and close local-client sockets; browser pairings remain valid |
| `bridge release` | Free the active slot or reconnect lease without deleting its pairing |

Interactive `auth approve` always acts on the request it displayed. If that request expires,
it fails without choosing another. A negative answer leaves the request pending, unlike bare
`auth`, which denies it. Scripts must pass `--yes`.

Browser labels need not be unique; use client ids to distinguish them. To rename a browser,
unpair and pair again. *Disconnect* preserves its pairing. *Unpair* revokes it, while *Forget local*
only deletes the browser's credential. After `bridge release`, the released browser stays stopped
until its operator chooses *Connect*.

### Pruning idle pairings

`auth prune` uses `lastSeenAt` to find idle pairings and protects the active bridge and any holder
of a reconnect lease. Interactive use lists candidates and asks once before removal. The daemon
recomputes candidates when the command runs, so a pairing that crosses the cutoff while the
prompt waits can be removed even if it was not listed. Use `auth revoke <pairingId>` to remove
only a specific profile.

There is no dry run. `--older-than 0` selects all idle pairings, subject to active-bridge and
lease protection. An empty initial listing skips the prompt but still runs the prune operation.
For scripts and JSON output, pass `--yes` to skip the listing and prompt.

## Local configuration

`config get` shows the config path and non-secret settings. `config set-upload-limit <size>`
changes the raw upload-byte limit; restart the daemon for it to take effect.

If set, `XDG_CONFIG_HOME` places configuration under `$XDG_CONFIG_HOME/fvtt-world-cli`. Otherwise:

- Linux: `~/.config/fvtt-world-cli`.
- macOS: `~/Library/Application Support/fvtt-world-cli`.
- Windows: `%APPDATA%\fvtt-world-cli`.
