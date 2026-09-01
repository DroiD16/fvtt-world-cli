---
name: foundry-world-editor
description: Use for live Foundry VTT reads or edits, or work with fvtt-world-cli, worldctl, the bridge, or daemon.
---

# Foundry World Editor (fvtt-world-cli)

`fvtt-world-cli` talks to a local authenticated daemon that relays typed commands to a bridge
module running in an open GM Foundry browser session. Every mutation executes through Foundry's
own Document APIs inside that session. Treat the world as concurrent state: users, game systems,
modules, and hooks can change it between commands.

## Health check

Confirm the runtime before planning any work:

```bash
fvtt-world-cli system info --json
```

Proceed only when `.result.bridge.status` is `connected`, and verify the reported world and GM are
the intended targets. If the daemon is not running, start `fvtt-world-cli bridge serve` as a
persistent background process (it does not daemonize itself) and leave it running for the whole
session. If no bridge connects, a GM must have the target world open in a browser with the
`fvtt-world-cli` module enabled and paired.

Pairing is a first-run trust decision that needs the human: ask the GM to open Module Settings →
Authorization, name the browser in the `Browser label` field, and choose Pair; run
`fvtt-world-cli auth pending`, confirm the listed Origin, world, GM, browser label, and client id,
then `auth approve <code> --yes`. Never run bare `fvtt-world-cli auth`: that is the human's
one-command pairing wait, it blocks until a request arrives or Ctrl+C ends it, and it refuses
`--json`. Hand that command to the GM at their own terminal instead of running it here. A pairing
belongs to one browser, so the same GM on the same world can hold several records, and the label is
chosen in the browser and fixed once paired. Labels are not unique and can render as nothing, so the
client id is what tells concurrent requests apart and confirms that a re-pair replaces the record you
meant; on a first pair it is newly minted, with nothing to match it against. Non-interactive use
requires `--yes`, which prints no identity and skips the confirmation prompt: read all five fields
from `auth pending` first, and never approve a request whose Origin, world, or GM you did not
expect.

`BRIDGE_NOT_READY` means the daemon is reachable but no GM client is connected yet. `BRIDGE_BUSY`
means another paired browser holds the active bridge slot: clear it with
`fvtt-world-cli bridge release` and have the GM choose Connect in the module's Authorization
window or World CLI scene-controls group. Keep the existing pairing.

`UNSUPPORTED_PROTOCOL_VERSION` means the installed components come from different releases. Read
`details.staleComponent`. Update the Foundry module for `module`. Update the CLI and restart the
daemon for `cli-daemon`. Compare the reported versions for `unknown`.

## Hard rules

- Pass `--json` on every automated call.
- Keep all world edits in the CLI. Leave Foundry world files and the browser UI untouched.
- Address documents by `id`, never by name; names are not unique. Embedded ids are meaningful only
  with their complete parent chain (actor → item → effect, scene → token → item).
- Ownership changes go through dedicated `*.ownership.set` commands; raw `ownership` is rejected
  in ordinary payloads.
- The CLI cannot evaluate arbitrary JavaScript, edit compendium packs in place, or reach outside
  the managed file boundary, and ordinary region-behavior writes reject executable types. Do not
  look for workarounds; report the limitation instead.
- Check stderr before diagnosing a hung command. An approval-listed command prints a waiting line
  while the GM decides in Foundry. Deletions require approval by default.

## Disabled commands

Some commands ship denied. A command that `schema <command>` or `--help` knows but a
`commands --json` listing with `policy.applied: true` omits is disabled by the GM of this bridge:
report that it needs enabling in the Command permissions window instead of hunting for an
equivalent. `macro.execute` is the only way to run code and is not a workaround for a missing
command.

## Command-specific cautions

A macro that throws fails `macro.execute` with a partial outcome — read what it touched before
retrying — while a macro that catches its own errors still returns `null`, which proves nothing;
verify effects with reads, and treat `MACRO_TIMEOUT` as indeterminate — the macro may still be
running.
`setting.set` cannot touch this module's own namespace (`SETTING_PROTECTED` is final; never retry).
When a setting write returns `requiresReload: true`, the change needs a GM-client reload to take
effect; `system.reload` performs it, drops the bridge, and requires a reconnect wait before the
next command. The reload commonly races its own result: the page can go away before the confirming
`reloading: true` is delivered, so a disconnect or `APPROVAL_UNKNOWN` there is the expected success
signal, not a failure — reconnect and continue rather than retrying the reload.

## The working loop

Discover → inspect schema → locate → read → smallest patch → dry-run → commit → verify. Never
guess a command name or parameter.

1. Run `fvtt-world-cli commands --json`. Continue only when `policy.applied` is `true` and the
   required command is present. A `false` value means no bridge answered and the output is the static
   registry, not the client's permissions. Report an absent command instead of seeking another way
   to produce the same effect. Warn the user before a command marked `"approval": true`, and prefer
   one `*-many` command when it can replace several approvals. Dotted protocol names map to spaced
   CLI subcommands, such as `actor.item.update` to `actor item update`.
2. `fvtt-world-cli schema <command>` shows the exact request parameters, required fields, enums,
   and whether unknown fields are accepted; `fvtt-world-cli <command path> --help` maps flags.
3. Locate targets with the narrowest query: a family `list --name <substring> --limit <n>` when
   the family is known, `world.search` when it is not, `compendium.index` for one pack. Page with
   `limit`/`offset` until `hasMore` is false. List and search rows are lean discovery projections,
   never the basis of a write.
4. `get` the complete target before mutating and work from the returned ids.
5. Build the smallest valid patch. Nested objects merge recursively; plain arrays replace
   wholesale; dotted paths reach permitted leaves; deletion operators remove permitted keys. A
   `get` result contains read-only and derived fields, so build the patch from accepted fields only.
   For arrays and extensible `system`/`flags` data: read, preserve everything that
   stays, change only the intended part.
6. Dry-run every nontrivial mutation with the global `--dry-run` flag. It runs the same
   validation, sanitization, permission, capability, and security checks, then stops before
   persistence; check both `ok` and `.result.dryRun`. A preview reports only what is knowable
   before execution and reserves nothing. Approval does not hold a preview. A denied command still
   fails, and `approvalRequired: true` means the commit will wait for the GM.
7. Commit with the same content. Attach `--idempotency-key <stable-key>` to any create, clone,
   import, upload, or action that might be retried. Use one key per logical operation. After response
   loss, follow the retry classification below because the delivery state determines whether to
   reuse the key or create a fresh one.
8. Verify with a fresh read. This matters most after open-schema writes, bulk operations, and
   actions, where confirmation can say less than an observed post-state.

The whole loop in miniature:

```bash
fvtt-world-cli actor list --name "Goblin" --limit 10 --json
fvtt-world-cli actor get --actor-id <id> --json
fvtt-world-cli --dry-run actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor update --actor-id <id> --name "Goblin Scout" --json
fvtt-world-cli actor get --actor-id <id> --json
```

## Reading results

Success responses use `{ok: true, result}` and failures `{ok: false, error: {code, message,
details}}`, alongside `protocolVersion`, `type`, and the correlation `id` (echoing your `id` in
`exec --stdin` batches). Branch on `error.code`, never on message text.
Documents live under a type-named key inside `result` that varies between commands but is stable
for each one. `id` is the public identifier; a `_id` mirror may accompany it. Values requested
through `include` flags may be derived or version-dependent. Write them back only when the
update schema explicitly accepts them.

## Retry classification

Classify a failure before reacting:

- Fix usage and validation errors before sending a new request.
- Treat permission, safety, and capability errors as unavailable operations. Change the operation or
  runtime instead of retrying the same call.
- Connection refusal, `BRIDGE_NOT_READY`, and `IDEMPOTENCY_STORE_FULL` mean Foundry received nothing.
  Retry after restoring the connection or after earlier keys settle. Reuse the same request and key.
- `BRIDGE_TIMEOUT` and a response timeout after send are unresolved deliveries. Read world state
  first. Reuse the same key only while the bridge session that carried the request remains connected.
- `BRIDGE_DISCONNECTED` is indeterminate. Read world state, report the result, and use a fresh key if
  the operation still needs to run.
- `COMMAND_DENIED` means nothing ran and the command is unavailable in that client. Report the
  limitation instead of seeking another command with the same effect.
- `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, and `APPROVAL_CANCELLED` mean nothing ran. Report the outcome
  and wait for user direction. `APPROVAL_QUEUE_FULL` also means nothing ran, but it can clear after
  earlier requests settle.
- `APPROVAL_UNKNOWN` and unconfirmed cancellation are indeterminate. Read the affected documents,
  report the result, and use a fresh key if the operation still needs to run.
- Correct a structured Foundry rejection and submit the corrected content as a new operation.

## Bulk writes and actions

Bulk commands (`create-many`, `update-many`, `delete-many`) share single-command validation but
are not transactions: check the top-level `complete` flag and inspect every entry in `outcomes`.
Persisted statuses such as `created`, `updated`, and `deleted` mean something different from
`unchanged`, `alreadyDeleted`, `dropped`, and `unknown`; the authoritative status set lives in the
protocol constants, not here. Action commands
(playback, draws, deals, combat transitions, thumbnails, fog) call fixed typed Foundry methods and
can trigger hooks, chat output, and system automation; read the schema, dry-run first, and
interpret confirmation fields literally rather than assuming an ordinary update happened.

## Managed files

File commands address Foundry's managed `data` source only, and writes are confined to the active
world's allowed tree. A file mutation never rewrites document fields: upload or move the asset,
take the normalized returned path, update each document reference with an explicit document
command, verify, and only then delete the old file. `world.audit-files` finds references to
missing assets; it is not an orphan-file collector.

## Context hygiene

Large worlds overflow agent context fast. Use server-side filters and small pages, project
responses with targeted `jq` expressions, fetch bounded id sets with `get-many`, and send
independent batches through `exec --stdin` (one NDJSON response per request, each judged on its
own). Request derived fields only when needed, and never dump a whole world, search index, or
binary file into context.

## Deeper reference

`fvtt-world-cli docs` lists the durable contract documents shipped with the CLI, and
`fvtt-world-cli docs <name>` prints one: `commands` (human overview and workflows), `protocol`
(delivery, error, and session semantics), `security` (trust boundary), `compatibility` (Foundry
version differences), `getting-started` (first-run pairing walkthrough). The runtime registry in
`commands --json` and `schema` always outranks prose.
