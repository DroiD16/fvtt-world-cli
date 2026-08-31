# Commands

This is the human-readable overview of the `fvtt-world-cli` command surface. The `worldctl` executable
is an equivalent short alias. This guide uses the canonical name. It explains shared behavior
and helps you find the relevant command family. For exact syntax in the installed version, use the
CLI's discovery commands.

```bash
fvtt-world-cli commands
fvtt-world-cli schema <protocol-command>
fvtt-world-cli <command path> --help
fvtt-world-cli docs [document]
```

For example, `fvtt-world-cli schema actor.update` shows the protocol request schema while
`fvtt-world-cli actor update --help` shows its CLI flags. `docs` lists and prints the documentation
shipped with the installed CLI, this guide included. Agents operate through the packaged agent
skill, managed with the `fvtt-world-cli skill install`, `skill update`, and `skill remove`
commands; [Agent skill](skill.md) covers the whole lifecycle.

## Before you begin

Start the local daemon and keep an authenticated GM client open in the target Foundry world:

```bash
fvtt-world-cli bridge serve
```

On first run, that GM client is paired once. With the daemon running, Foundry's Module Settings →
Authorization carries a Pair button, and one command in the terminal covers the rest: it waits for
the request, prints the Origin, world, GM, and browser label it carries, and asks for a yes or no.

```bash
fvtt-world-cli auth
```

The wait can be started before or after Pair is clicked: a request that is already pending surfaces
immediately. Reading a request over before deciding, or approving from a script, is the two-step path
instead, where non-interactive approval requires `--yes`:

```bash
fvtt-world-cli auth pending
fvtt-world-cli auth approve [code]
```

The full first-run walkthrough is in [Getting started](getting-started.md).

Confirm the connection before reading or writing:

```bash
fvtt-world-cli system info --json
```

Profiles can be inspected with `auth list`, revoked independently or pruned once they fall idle, and
the active slot can be cleared with `bridge release`. The daemon never prints a secret.

### Authorization commands

- `auth` with no subcommand waits for a pairing request and approves it on the spot. It prints an
  instruction to click Pair in the module's Authorization window, and the request surfaces in the
  terminal as soon as the daemon receives it, including one that was already pending when the command
  started. Several live requests are not an obstacle to it as they are to `auth approve` with no code:
  the wait renders the earliest one and asks about that, and a later request stays pending for another
  run. The wait itself is indefinite: it ends on Ctrl+C, on an answer, or if the daemon connection
  drops, which is reported as `DAEMON_UNAVAILABLE` rather than a silent stop and is safe to re-run once
  the daemon is back. `y` or `yes` approves the displayed code and exits 0, any other answer denies that
  code and exits 1 with `PAIRING_DECLINED`.
  Ctrl+C, or an ended stdin, at the confirmation instead leaves the request untouched, and it stays
  pending until it expires or another run answers for it. An ended stdin, and Ctrl+C while output goes
  to the terminal too, report `PAIRING_PROMPT_ABORTED` and exit 1; with output redirected the prompt
  does not read keystrokes itself, so Ctrl+C ends the run as an ordinary interrupt instead.
  Delivery is a long-poll control call the CLI re-issues on its own, and the daemon answers each call
  inside its own park cap, so an ordinary wait does not end in a timeout; a daemon that stops answering
  altogether still trips the client's request timeout and is reported as `DAEMON_UNAVAILABLE`. The
  command is interactive-only: `--json`, and a stdin that is not a terminal, each fail
  immediately and name `auth pending` plus `auth approve --yes` as the path for scripts.
  `--timeout-ms` cannot cut the wait short either — a value below the daemon's park cap plus five
  seconds is raised to it for the long-poll call, because a smaller client wait would abandon a parked
  response the daemon is still holding. That long poll is the only call the flag cannot shorten: the
  approval or denial that follows the answer, and the listing an interactive `auth approve` or
  `auth prune` reads before its prompt, take `--timeout-ms` as given for their client wait, as the
  other `auth` verbs and `bridge release` do; without the flag that wait is 60 seconds.
- `auth status` shows bridge state and public profile metadata.
- `auth pending` lists approval candidates with code, expiry, exact Origin, world, GM, browser client
  id, browser label, and module version.
- `auth approve [code] [--yes]` approves one request. The code may be omitted only when exactly one
  request is pending. Interactive use confirms the displayed identity, including the browser label and
  client id, and then approves that exact request: one that expired or disappeared while the prompt
  waited fails rather than approving whatever else is pending. When no single pending request can be
  shown — nothing pending, an unknown code, or several candidates — it names the live pending codes and
  stops instead of asking. Answering anything but `y` or `yes` cancels the approval, reports
  `PAIRING_DECLINED` and exits 1 — the same code and exit the bare `auth` wait reports for a declined
  request, which the wait also denies outright while this verb leaves it pending. Interrupting the
  prompt also leaves the request pending, and reports `PAIRING_PROMPT_ABORTED` with exit 1 on the same
  terms as the wait. Scripts must pass `--yes`. The stored label is the one the browser sent — approval
  does not rename it.
- `auth deny <code>` rejects a pending request.
- `auth list` shows non-secret profile metadata, including each profile's `clientId` and `label`.
  A label is set in the browser at pairing time and no control operation renames a stored record, so
  a browser that needs a different label unpairs and pairs again. A browser that only forgot its local
  credential keeps its record, and the next approval adopts the label that request carried. Labels are
  not unique, so two browsers may share one. A profile's `lastSeenAt` is stamped when it is approved,
  when its browser connects the bridge, when that connection ends, and when a hello is turned away
  because another profile owns the slot, so the timestamp measures how long the profile has been idle
  rather than how long ago it last connected. A second browser that is opened daily while the first
  one holds the bridge therefore stays fresh and is never pruned out from under its owner.
- `auth prune [--older-than <days>] [--yes]` deletes the profiles that have gone unused. A profile is
  a candidate when its `lastSeenAt` is older than the cutoff, which defaults to 30 days; the active
  bridge profile and the holder of an abnormal-disconnect lease are never deleted, however idle their
  stored timestamp looks. Interactive use lists the candidates it found — label, client id, world, GM,
  last-seen timestamp, and pairing id — and asks once for the whole set. The listing skips the profile
  `auth list` reports as active, so a browser that has stayed connected past the cutoff is neither shown
  nor counted in the prompt, matching what the daemon will do. Answering anything but `y` or
  `yes` removes nothing, reports `PAIRING_DECLINED` and exits 1; interrupting the prompt reports
  `PAIRING_PROMPT_ABORTED` and exits 1 on the same terms as `auth approve`. A listing that found no
  candidate asks nothing and still runs the operation, so the command's output is the daemon's own empty
  result rather than a local verdict. The listing is a preview only: the daemon recomputes the set,
  against the cutoff as it stands when the command runs, and its own result is what the command prints.
  The executed set can therefore be larger than the one the prompt counted, because a profile that
  crossed the cutoff while the prompt waited is removed although it was never listed; it can equally be
  smaller, because a profile that became active or was already removed between the two steps is
  reported as the daemon left it. There is no dry-run mode, and `--older-than 0` treats every profile
  as idle, which is the one case where a preview can name a lease holder the daemon then keeps —
  `auth list` does not expose the lease, and a lease holder's last-seen timestamp is fresh by
  definition, so no realistic threshold selects it. Scripts pass `--yes`, which skips both the preview
  and the prompt; `--json` requires `--yes` as well, because the confirmation is never mixed into JSON
  output, and without it the command stops with exit 2.
- `auth revoke <pairingId>` deletes one daemon profile and disconnects it if active.
- `auth rotate-client --yes` replaces the device-local CLI/Companion credential and closes existing
  local-client sockets without invalidating browser pairings.
- `bridge release` clears the active slot or abnormal-disconnect lease without deleting a profile.
  An active browser stopped by release stays stopped until its operator chooses Connect.

Every command in this section is answered by the daemon alone, with no Foundry browser involved, so
a daemon that is not running or not reachable ends any of them — the `auth` verbs and
`bridge release` alike — with `DAEMON_UNAVAILABLE` and exit 3 rather than a command-level failure.

In Foundry, Connect reuses the stored browser credential and Disconnect releases the slot without
touching it. Unpair waits for confirmed daemon revocation
before deleting that credential. If revocation cannot be confirmed, it retains the credential and
offers Forget local as the explicit recovery path; Forget local does not revoke the daemon profile.
`BRIDGE_BUSY` likewise preserves the credential: release the current bridge and choose Connect.

### Local configuration

- `config get` shows the config path and non-secret settings.
- `config set-upload-limit <size>` persists the raw upload-byte limit. The daemon preserves this
  field across later pairing and bridge-session writes, but a running daemon must be restarted before
  its WebSocket transport and the browser bridge advertise the new limit. JSON output includes
  `daemonRestartRequired: true`.

## Finding the right command

Command names describe the document nesting. Dots are used in the protocol registry; spaces are used
on the CLI:

| Goal | Protocol family | CLI shape |
|---|---|---|
| World actors | `actor.*` | `fvtt-world-cli actor …` |
| Items embedded in an actor | `actor.item.*` | `fvtt-world-cli actor item …` |
| Effects on an actor item | `actor.item.effect.*` | `fvtt-world-cli actor item effect …` |
| Tokens embedded in a scene | `scene.token.*` | `fvtt-world-cli scene token …` |
| Effects on a placed token | `scene.token.effect.*` | `fvtt-world-cli scene token effect …` |

Use `fvtt-world-cli commands --json` for the current inventory. The exact operation set
varies by family, so a nearby document family is not a reliable guide to what another one supports.
With a bridge connected, that inventory is also filtered by the GM client's command permissions, as
[Discovery under a policy](#discovery-under-a-policy) describes.

## Capability map

### World content

- `actor`, `item`, `journal`, `scene`, `macro`, `playlist`, `table`, and `cards` manage world
  documents.
- `chat` reads, creates, and deletes chat messages. `chat flush` erases the entire log at once and
  asks for GM approval by default because nothing brings the messages back.
- `user` manages Foundry user accounts. `user update` edits harmless profile fields, `user create`
  and `user delete` ask for approval by default, and `user role set` plus `user permissions set` are
  [off by default](#commands-that-are-off-by-default). No command reads or writes a password, and
  the account holding the bridge cannot demote or delete itself; see
  [Security](security.md#users).
- `setting` lists registrations and reads values, including `setting get-many` for batch reads.
  `setting set` and `setting set-many` write world, client, and user scopes but are
  [off by default](#commands-that-are-off-by-default); they refuse this module's own namespace in
  every mode, and a write to an already-stored value is reported as unchanged without touching
  Foundry. A result carrying `requiresReload: true` names the follow-up that Foundry expects, which
  `system reload` performs.
- `combat` manages encounters and exposes explicit encounter transitions.
- `folder` manages document organization.
- Dedicated `*.ownership.set` commands change supported document ownership.

Common world-document operations include `list`, `get`, `get-many`, `create`, `update`, `clone`, and
`delete`. The exact set varies by family.

### Embedded content

- `actor.item` manages an actor's embedded items.
- `*.effect` families manage ActiveEffects on actors, items, actor items, tokens, and token items.
- `journal.category` manages journal page categories.
- `playlist.sound` manages playlist tracks.
- `table.result` manages roll-table rows.
- `cards.card` manages cards inside a stack.
- `combat.combatant` and `combat.group` manage encounter membership.
- `scene.token`, `tile`, `sound`, `wall`, `note`, `drawing`, `light`, `template`, and `region` manage
  scene placeables.
- `scene.region.behavior` manages region behaviors; writes that supply executable core behavior
  types are rejected (see [Security](security.md#executable-content)). The separate
  `scene.region.behavior.executable` family, [off by default](#commands-that-are-off-by-default),
  authors `executeMacro` behaviors that reference an existing world macro; `executeScript` has no
  command surface at all. Deleting an executable behavior uses the ordinary
  `scene region behavior delete`.

Embedded commands require the complete parent ID chain; a read of the parent supplies those IDs when
they are not already known.

### Actions

Some commands invoke a typed Foundry action instead of ordinary CRUD:

- playlist and playlist-sound playback;
- roll-table draw and reset;
- card shuffle, reset, deal, draw, and pass;
- combat start, activation, advancement, and initiative;
- scene thumbnail generation and fog reset;
- scene activation (`scene activate`) and pulling active users to a scene (`scene pull-users`);
- showing a journal entry (`journal show`) or an image (`image show`) to players;
- pausing or resuming the game clock for everyone (`game pause`);
- reloading the GM client (`system reload`), which asks for approval by default because it drops
  the bridge until the client reconnects;
- macro execution (`macro execute`), [off by default](#commands-that-are-off-by-default).

`macro execute` runs a world macro the GM can already execute, waits for it to finish up to a
bounded `--macro-timeout-ms`, and reports the returned value plus the chat messages it observed the
macro create. A macro that outlives the timeout keeps running in the GM browser and the command
returns the indeterminate `MACRO_TIMEOUT`, so the effect is verified by reads. A script macro that
throws fails the command and the error names what the macro raised; the outcome is partial, because
whatever the macro changed before it threw stays changed. A macro that catches its own errors still
reports a `null` return, and a macro is free to reload the page or navigate away, which ends the
bridge session the same way any disconnect does. Effects therefore deserve a read-back whenever the
return value alone does not prove them.

The result's `chatCapture` field says how much of the chat the run observed: `captured` when every
message the macro was expected to create was seen, `not-created` when a chat macro created none,
`partial` when only some were seen, and `unknown` when this client could not watch the chat log at
all.

Actions can have Foundry, system, or module side effects. Their result describes what the bridge can
confirm, which may differ from a document post-state, so each action's schema and help are worth
reading before automating it.

### Discovery and maintenance

- `world.search` finds content across supported world and optional compendium indexes.
- `world.audit-files` finds document references to missing managed assets.
- `compendium.list`, `compendium.index`, and `compendium.get` read pack content.
- Supported `*.import-from-compendium` commands create world documents from pack sources.
- `user list`/`user get` and `setting list`/`setting get`/`setting get-many` are the discovery
  side of the [user and setting families](#world-content).

### Managed files

`file` commands operate on Foundry's managed `data` source. Reads can inspect managed assets. Writes
are restricted to the active world's allowed tree and exclude its manifest, databases, and packs.
Document references are updated separately with an explicit document command.

See [Security](security.md#file-write-boundary) before automating file writes.

## Shared command behavior

### Command permissions and approval

Every command has one of three behaviors in the GM client that holds the bridge: allow, approve, or
deny. A GM edits them under Configure Settings → Module Settings → World CLI → Command permissions.
The settings belong to the browser profile, so another browser or machine can apply a different
policy.

An approved command waits for the GM instead of failing. Foundry opens the Command Approval window.
It shows the command, its targets, and its parameters. The CLI writes one status line to stderr:

```
Waiting for GM approval in Foundry (command actor.delete, expires 2026-08-28T18:20:00.000Z). Press Ctrl+C to request cancellation.
```

The line uses stderr in both output modes, so `--json` stdout still carries one envelope. Allow runs
the command at the time of the decision. The module repeats the normal guards first because world
state and permissions may have changed while the request waited. The CLI then returns the command's
success or error.

The wait tolerates short daemon outages, bridge reconnects, and poll timeouts while the approval
remains open. Other outcomes use structured errors:

| Code | Meaning | State |
|---|---|---|
| `COMMAND_DENIED` | The permission is deny, whether at the request or by the time an approved command runs | Not executed |
| `APPROVAL_DENIED` | The GM chose Deny | Not executed |
| `APPROVAL_TIMEOUT` | No decision was taken before the approval expired | Not executed |
| `APPROVAL_CANCELLED` | A cancellation the GM client confirmed won the decision | Not executed |
| `APPROVAL_QUEUE_FULL` | The module refused admission before showing the request | Not executed |
| `APPROVAL_UNKNOWN` | The module no longer holds the decision | Indeterminate |

`APPROVAL_UNKNOWN` means the client can no longer prove whether the command ran. Read the affected
world state before trying again. `APPROVAL_QUEUE_FULL` means the module refused the request before
execution. Retry after the GM clears earlier requests.

Ctrl+C asks the GM client to cancel a waiting decision. Only `APPROVAL_CANCELLED` proves that the
command will not run. If the command has started or the client cannot confirm cancellation, the CLI
reports an indeterminate result.

The default policy sorts commands into the three behaviors by what a mistake would cost. Commands
that can execute code, change who can do what, or persist outside the world's own data are denied
until a human enables them; the next section lists them. Commands that destroy world data — the
`delete` and `delete-many` verbs, plus `file.move`, `scene.fog.reset`, and `chat.flush` — ask for
approval, as do `system.reload` and `user.create`. The remaining commands run on their own unless
they are exempt from the policy. The Command permissions window and
`fvtt-world-cli commands --json` show the current inventory.

#### Commands that are off by default

The following commands ship with the deny behavior. They stay invisible to
[discovery](#discovery-under-a-policy) and refuse to run — even as dry runs — until a GM enables
them in the Command permissions window of the browser profile holding the bridge:

- `macro.execute`
- `setting.set`
- `setting.set-many`
- `user.role.set`
- `user.permissions.set`
- `scene.region.behavior.executable.create`
- `scene.region.behavior.executable.update`
- `scene.region.behavior.executable.clone`

They are denied by default because each one executes code, changes who can do what, or persists
outside the world's own data. Enabling one is a per-browser-profile decision, and the approval
behavior remains available as a middle ground: a GM who wants to see every macro body before it
runs sets `macro.execute` to approve rather than allow. [Security](security.md) describes what each
of these surfaces can and cannot do.

`system.ping`, `system.info`, and the internal approval-wait commands always run. This keeps the
bridge able to report its state and finish an existing decision. The permissions window omits those
commands. Pairing and other `auth` operations run in the daemon, outside the command policy.

Foundry plays its standard interface notification when a request enters an empty queue. The `Play a
sound on approval requests` setting controls it. Browsers may delay the first sound until the GM
interacts with the page after a reload.

Set the approval deadline with `Approval timeout (minutes)` in the main Module Settings form. The
form and protocol enforce the supported range. Expiry refuses the command without running it.

Approval state lives in the GM client's memory. Reloading that client or ending its bridge session
can produce `BRIDGE_DISCONNECTED` or `APPROVAL_UNKNOWN`. Both are indeterminate. Read the affected
world state before another write, then use a fresh idempotency key if the command still needs to run.
The complete state and retry contract is in [Protocol](protocol.md#approval-flow).

### Discovery under a policy

With the bridge reachable, `commands` and `commands --json` describe what that GM client will
actually run. The listing omits denied commands. JSON marks approval waits with `"approval": true`;
plain output uses an `approval` tag. The JSON envelope also contains
`policy: { "applied": true, "source": "bridge" }`.

When no bridge answers, the listing falls back to the full static registry and says so:
`policy: { "applied": false, "source": "static", "reason": … }` in JSON, and a warning on stderr in
plain output. Only an unavailable daemon or bridge triggers fallback. Authentication, validation,
and protocol failures return errors.

`schema`, `--help`, and this documentation describe the whole static registry. If a caller sends a
denied command found there, the GM client returns `COMMAND_DENIED`. Discovery hides; the client
enforces.

### JSON output

Use `--json` for automation. Successful requests use a stable envelope:

```json
{
  "protocolVersion": "…",
  "type": "command.response",
  "id": "…",
  "ok": true,
  "result": {
    "actor": {}
  }
}
```

Documents are stored under a type-named result key such as `actor`, `items`, `scene`, or `outcomes`.
The key varies between commands but is stable for each one, so a first response shows what to script
against. Errors use `ok: false`, a stable code, a
message, and optional details; see [Protocol](protocol.md#error-model).

Serialized Foundry documents generally expose `id` as the public identifier and may also expose the
source `_id` mirror. Use the documented `id` fields for subsequent commands.

### Input validation

Input is validated locally and again at the Foundry boundary. Unknown options, missing required
options, and malformed CLI values are usage errors. Protocol payloads use closed schemas where the
bridge owns the writable field set and sanitized open schemas where Foundry or a game system owns
extensible data.

Use JSON flags such as `--data-json`, `--patch-json`, and family-specific JSON flags for structured
values. The command schema is the definitive description of accepted keys.

### Lists, filters, and pagination

List-like commands that support pagination accept `limit` and `offset` and return collection data
plus `total` and `hasMore`. One response is not guaranteed to contain the entire collection; paging
continues until `hasMore` is false.

Some collections support a case-insensitive `name` filter before pagination. Search commands use
their own matching rules and are not interchangeable with a list filter. Whether a filter exists is
recorded in each command's schema.

### Reads and projections

Single-document `get` operations return the documented authored projection. Some commands accept
`include` values for derived or expensive data. Derived data is explicitly identified and can vary by
Foundry version and game system.

List rows are intentionally smaller than `get` results and are not sufficient to construct an update
from; that starts from a fresh `get`.

### Updates and merge semantics

Updates are patches, not full replacements:

- nested objects merge recursively;
- ordinary arrays replace as a whole;
- dotted paths target a nested leaf where the schema permits them;
- Foundry deletion syntax can remove permitted nested keys;
- embedded-document collections follow their family-specific Foundry semantics.

Arrays and extensible system data are the easiest fields to clobber: an array patch replaces the
whole array, so one built from stale state silently drops entries. A fresh read before editing, the
smallest patch that expresses the change, and a read-back afterwards avoid that.

### Dry run

All mutation commands accept the global `--dry-run` flag:

```bash
fvtt-world-cli --dry-run actor update --actor-id <id> --name "New name" --json
```

The result uses the normal command shape and includes `dryRun: true`. The preview contract — what a
dry run executes, what it can report, and its non-reservation of state — is defined in
[Protocol](protocol.md#dry-run).

Approval does not hold a preview. A command whose permission is approve previews without asking the
GM, and its result carries `approvalRequired: true` so the caller knows the commit will wait. The GM
client returns `COMMAND_DENIED` for a denied preview.

### Idempotency and retries

Commands with duplicate-creation or non-repeatable-action risk may require or accept an idempotency
key. An operation that timed out or disconnected may already have reached Foundry, so a blind retry
can apply it twice. Key semantics and delivery-state retry rules are defined in
[Protocol](protocol.md#idempotency) and
[Protocol](protocol.md#delivery-states-and-retries).

### Batch reads and bulk writes

`get-many` reduces round trips for independent reads. `exec --stdin` sends NDJSON commands over one
connection while retaining an individual response for each request.

Families that expose `create-many`, `update-many`, or `delete-many` validate the envelope and each
element before dispatch, but the persistence layer is not transactional. Inspect `complete` and every
entry in `outcomes`; see [Protocol](protocol.md#batch-requests-and-bulk-writes).

### File paths

Pass literal managed-data paths. The bridge normalizes and encodes document asset references where
appropriate; callers should not pre-encode ordinary filename characters. URLs, virtual texture IDs,
and other special values follow the receiving field's schema.

## Common workflows

### Find, inspect, update, verify

```bash
fvtt-world-cli actor list --name "Goblin" --json
fvtt-world-cli actor get --actor-id <id> --json
fvtt-world-cli --dry-run actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor get --actor-id <id> --json
```

### Discover an unfamiliar command

```bash
fvtt-world-cli commands --json
fvtt-world-cli schema scene.token.create
fvtt-world-cli scene token create --help
```

### Work with an embedded document

```bash
fvtt-world-cli scene token list --scene-id <sceneId> --json
fvtt-world-cli scene token get --scene-id <sceneId> --token-id <tokenId> --json
```

First-run setup is covered in [Getting started](getting-started.md).

## Unsupported boundaries

The CLI intentionally does not provide arbitrary JavaScript evaluation, direct world-database
writes, unrestricted filesystem access, generic RPC, compendium editing, or transactional Foundry
batches. Code runs only through `macro.execute` and `executeMacro` region behaviors — both off by
default, both showing the GM exactly what would run. [Security](security.md) describes the trust
boundary and [Foundry compatibility](compatibility.md) the version-dependent capabilities.
