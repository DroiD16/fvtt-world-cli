---
name: foundry-world-editor
description: Use when a request involves reading or changing anything in a live Foundry VTT world — or mentions fvtt-world-cli, worldctl, or the Foundry bridge/daemon.
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
`--json` — hand that command to the GM at their own terminal instead of running it here. A pairing
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
window or World CLI scene-controls group — do not start a new pairing.

`UNSUPPORTED_PROTOCOL_VERSION` means the two halves come from different releases. Read
`details.staleComponent` and tell the user what to update: `module` is the Foundry module,
`cli-daemon` is the CLI plus a restart of the running daemon, `unknown` means the two versions in
`details` have to be compared by hand.

A command that seems to hang is usually waiting for a GM approval, not stuck: the CLI prints a
waiting line on stderr and Foundry shows a Command Approval window. Check that window before
concluding anything is broken.

## Hard rules

- Pass `--json` on every automated call.
- Never edit Foundry world files on disk and never automate the Foundry browser UI; this CLI is
  the control surface.
- Address documents by `id`, never by name; names are not unique. Embedded ids are meaningful only
  with their complete parent chain (actor → item → effect, scene → token → item).
- Ownership changes go through dedicated `*.ownership.set` commands; raw `ownership` is rejected
  in ordinary payloads.
- The CLI cannot execute JavaScript, write settings, edit compendium packs in place, or reach
  outside the managed file boundary, and executable region-behavior types are rejected on write.
  Do not look for workarounds; report the limitation instead.
- A command can block on a human: the GM client's command permissions send some commands, deletions
  by default, to an approval window in Foundry, and the call waits for that decision.

## The working loop

Discover → inspect schema → locate → read → smallest patch → dry-run → commit → verify. Never
guess a command name or parameter.

1. `fvtt-world-cli commands --json` lists the commands the connected GM client will run and marks
   mutations. Dotted protocol names map to spaced CLI subcommands (`actor.item.update` →
   `actor item update`). Treat the list as that client's permissions only when the envelope reports
   `policy.applied: true`; `false` means no bridge answered and the full static registry is printed
   instead. A daemon that rejects this client's credential fails the command outright
   rather than falling back; that is a mismatched local setup to report, not a call to retry. Under an applied policy, an absent command is missing functionality — do not work around
   it, tell the user — and a command marked `"approval": true` blocks the real call until a GM
   allows it, so warn the user before starting and prefer one `*-many` envelope over many
   single-approval calls.
2. `fvtt-world-cli schema <command>` shows the exact request parameters, required fields, enums,
   and whether unknown fields are accepted; `fvtt-world-cli <command path> --help` maps flags.
3. Locate targets with the narrowest query: a family `list --name <substring> --limit <n>` when
   the family is known, `world.search` when it is not, `compendium.index` for one pack. Page with
   `limit`/`offset` until `hasMore` is false. List and search rows are lean discovery projections,
   never the basis of a write.
4. `get` the complete target before mutating and work from the returned ids.
5. Build the smallest valid patch. Nested objects merge recursively; plain arrays replace
   wholesale; dotted paths reach permitted leaves; deletion operators remove permitted keys. Never
   send a `get` result back as a patch — it contains read-only and derived fields the update
   schema rejects. For arrays and extensible `system`/`flags` data: read, preserve everything that
   stays, change only the intended part.
6. Dry-run every nontrivial mutation with the global `--dry-run` flag. It runs the same
   validation, sanitization, permission, capability, and security checks, then stops before
   persistence; check both `ok` and `.result.dryRun`. A preview reports only what is knowable
   before execution and reserves nothing. A preview is never held for approval, but a denied
   command is refused in preview too, and `approvalRequired: true` in the result means the commit
   below will wait on a GM.
7. Commit with the same content. Attach `--idempotency-key <stable-key>` to any create, clone,
   import, upload, or action that might be retried — one stable key per logical operation. Reuse
   that same key if you send the command again after a lost response, including one lost while an
   approval was pending.
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
through `include` flags may be derived or version-dependent — never write them back unless the
update schema explicitly accepts them.

## Retry classification

Classify a failure before reacting:

- Usage or validation error — fix the request.
- Permission, safety, or capability error — a different operation or runtime is needed; retrying
  the same call cannot succeed.
- Not forwarded (connection refused, `BRIDGE_NOT_READY`) — safe to retry once the stack is
  restored.
- Forwarded but unresolved (`BRIDGE_TIMEOUT`, `BRIDGE_DISCONNECTED`, a timeout after send) — the
  mutation may already have committed: inspect world state first, and reuse the same idempotency
  key when retrying the same logical request. Never mint a new key because a response was lost.
- Refused by the GM client's command permissions (`COMMAND_DENIED`) — nothing ran; the command is
  unavailable there. Report it as a limitation instead of reaching for another command that has the
  same effect.
- Approval refused (`APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, `APPROVAL_CANCELLED`) or never admitted
  (`APPROVAL_QUEUE_FULL`) — the command did not execute and nothing changed. Only queue-full clears
  on its own; a denial or a timeout is a human decision, so report it and ask, rather than looping
  the same request.
- Approval outcome lost (`APPROVAL_UNKNOWN`, or a cancellation the CLI reported as unconfirmed) —
  indeterminate: the command may have run. Read the documents it would have written, report what you
  found, and use a fresh idempotency key if you send it again.
- Structured Foundry rejection — correct the content and resubmit as a new operation.

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
version differences), `getting-started` (first-run pairing walkthrough). The runtime registry —
`commands --json` and `schema` — always outranks prose.
