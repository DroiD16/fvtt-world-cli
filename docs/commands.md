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
| Edit scene levels (v14) | `scene.level` |
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

### Token overrides

An unlinked token keeps its own copy of the actor's data in an actor delta: overridden items,
effects, system data, name and other fields. Edits to the world actor do not reach a value the
delta overrides, and `scene token item` commands on an unlinked token write into the delta.

```bash
fvtt-world-cli scene token list --scene-id <sceneId> --include delta --json
fvtt-world-cli scene token get --scene-id <sceneId> --token-id <tokenId> --include delta --json
fvtt-world-cli --dry-run scene token restore-delta --scene-id <sceneId> --token-id <tokenId> --json
fvtt-world-cli scene token restore-delta --scene-id <sceneId> --token-id <tokenId> --json
```

`scene token get --include delta` returns the stored delta under `token.delta`, or `null` for a
linked token or a token that stores none. `scene token list --include delta` adds `deltaSummary` to
each row instead. The bridge derives it from the stored delta. `itemEntries` and `effectEntries`
count the entries of the delta's `items` and `effects`, including deletion markers (tombstones)
for items or effects the token removes; they are not the token's item or effect count.
`overriddenKeys` lists the top-level keys that hold an override. Only a top-level value of `null`,
`[]` or `{}` overrides nothing. Any content below the top level counts, including a nested `null`,
`[]` or `{}`, because Foundry merges such a value into the actor and can replace what the actor
holds there. `deltaSummary` is `null` when no key holds an override, and `restore-delta` uses the
same rule.

`scene token restore-delta` discards every override of an unlinked token through Foundry's
`ActorDelta#restore()`, so the token follows its actor again. The token keeps its own `name` field,
while the actor-side name a delta overrode goes back to the world actor's name. The result reports
`changed` and, under `discarded`, the summary of what was removed; the dry run reports the same
summary without writing. A token without overrides returns `changed: false`, and a linked token is
refused with `INVALID_PARAMS`. The command succeeds only when a re-read finds no overrides left;
otherwise it fails with `INTERNAL_ERROR` and `details.paths` entries under `delta.<key>`.

### Build a scene with levels

On Foundry v14 a scene's maps live on its levels. Pass the levels when you create the scene:

```bash
fvtt-world-cli scene create --name "Tower" --json \
  --data-json '{"levels":[{"name":"Ground","background":{"src":"worlds/<worldId>/maps/ground.webp"}},
                          {"name":"Roof","elevation":{"bottom":20,"top":40}}]}'
fvtt-world-cli scene level list --scene-id <sceneId> --json
fvtt-world-cli scene level update --scene-id <sceneId> --level-id <levelId> \
  --patch-json '{"foreground":{"src":"worlds/<worldId>/maps/roof.webp"}}' --json
```

The first supplied level becomes the initial one. To start players on another level, run `scene
update --scene-id <sceneId> --initial-level <levelId>`; `--patch-json '{"initialLevel":null}'` goes
back to the first level. A scene keeps at least one level, so `scene level delete` and `delete-many`
refuse to remove the last one.

Deleting a level also deletes its tokens and every placeable that exists only on that level. A dry
run does not list them, so read the scene's placeables before deleting a level.

[Compatibility](compatibility.md) lists the scene map fields each Foundry version accepts.

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

Actor results carry `itemCount` in place of the owned items; `actor get` and `actor get-many`
return the items with `--include items`. `system info --include modules` lists installed modules.

World document reads report two provenance fields from Foundry's `_stats`: `compendiumSource`, the
compendium entry a document was imported from, and `duplicateSource`, the document it was
duplicated from. Each is `null` when Foundry stored none. List rows and items nested in an actor
result carry neither.

`compendium get` returns Foundry's raw source of the entry under `document`, with `id`,
`compendiumSource` and `duplicateSource` added next to its `_id`. `compendium get-many --pack <id>
--ids <list>` reads several entries of one pack in a single call. Each element of its `entries`
has the shape of a `compendium get` result. As with the other `get-many` commands, `entries` holds
one element per requested id in request order, and an unknown id fails the whole request, here
with `COMPENDIUM_ENTRY_NOT_FOUND`.

### Updates and merge semantics

Use JSON flags such as `--data-json` and `--patch-json` for structured values. Updates are patches:

- Nested objects merge recursively.
- Ordinary arrays replace as a whole.
- Dotted paths target object properties where permitted. The bridge expands them into nested
  objects and merges keys in order, so when two keys set the same leaf the later one wins. Dotted
  writes inside arrays are refused.
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

An update whose stored state differs from the request fails with `INTERNAL_ERROR`. The comparison
covers each requested path that survives Foundry's cleaning: Foundry drops a key the document's
schema does not declare without an error, so such a key is never compared and a write made only of
undeclared keys reports success with nothing stored. `details.paths` lists up to 20 differing paths, each with the requested and the stored value, and
`details.pathsTruncated` counts the rest. Foundry core, the game system and modules can all change
a value on its way into the world. Foundry's HTML
sanitizer, for example, stores a raw `&` in a rich-text field as `&amp;`. The bridge cannot tell such
a normalization from a hook that rewrote, dropped or vetoed the write, so the error reports the
values and leaves that judgment to the caller. Sending the same patch again stores the same result.

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
| `auth status` | Show bridge state, the commands the connected bridge advertised, and public profile metadata |
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
