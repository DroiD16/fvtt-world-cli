# Protocol

This document describes the stable integration contract between CLI clients, the local daemon, and
the Foundry bridge: what each party may assume, which guarantees survive reconnects and failures,
and how errors and retries are classified. It deliberately contains no wire-level inventory. Exact
message types, frame schemas, command names, request schemas, error codes, default timeouts, and
size limits are defined by the protocol package and discoverable at runtime:

- [`packages/protocol/src/commands.js`](../packages/protocol/src/commands.js)
- [`packages/protocol/src/schemas/`](../packages/protocol/src/schemas/)
- [`packages/protocol/src/constants.js`](../packages/protocol/src/constants.js)
- [`packages/protocol/src/validation.js`](../packages/protocol/src/validation.js)
- `fvtt-world-cli commands --json`, `fvtt-world-cli schema <command>`, and
  `fvtt-world-cli system info --json` for the installed checkout and the connected runtime

## Versioning

The protocol version is the product release version: every release sets it to that release's number,
even when the wire contract did not change. Every transport message carries it, matching is exact,
and an unsupported version is rejected at the bridge handshake and during command handling rather
than degraded silently. Both halves of an installation therefore come from the same release; a
daemon and a Foundry module from different releases refuse each other instead of negotiating a
subset. The current version is `1.1.0`.

Recovering from a refusal is an operator action rather than a retry: the older half is brought to
the current release, the daemon is restarted when the CLI and daemon half changed, and the GM client
is reloaded when its module load was the refused one, because a refused load does not reconnect on
its own.

`3.0` is the one protocol version published before the release-lockstep rule, and it is compared as
release `1.0.0`, so the accepted `3.0` → `1.1.0` step is ordered like any other release step. A
component built before the mismatch details described under the error model cannot present them when
it is the side reporting the failure; that gap is specific to the `3.0` transition.

## Transport model

The daemon listens on a loopback WebSocket endpoint. Credentials never appear in URLs. A local
client — the CLI or a future Companion — has no browser Origin and must establish its role with its
first message: the daemon enforces a short deadline for a valid first frame, closes malformed
openings immediately, and never assigns a role before authentication has succeeded. Browser sockets
are identified by their exact HTTP(S) Origin and participate only in pairing and bridge sessions;
they cannot assume the local-client role.

Every message type has a closed top-level schema. A malformed message yields a structured
`INVALID_MESSAGE` error where a response is possible, and an authenticated local client that sends
a malformed control request receives a correlated error and may keep using its connection.

The daemon accepts one active authenticated bridge at a time:

- another pairing cannot displace the active bridge and is rejected as `BRIDGE_BUSY`;
- a new socket from the same pairing takes the slot over — the tab-reload recovery path;
- a clean goodbye releases the slot immediately, while an abnormal close reserves it briefly for
  the same pairing;
- a daemon-initiated release is terminal for the released client: it does not reconnect on its
  own, and resuming is an explicit operator action.

## Size limits

The upload limit and the transport frame limit are distinct: the first bounds raw upload content,
the second accounts for encoding and envelope overhead and is never lower than what legitimate
large read responses require. The daemon advertises its effective limits during the handshake, and
the bridge checks response size before sending, so an oversized response returns
`PAYLOAD_TOO_LARGE` instead of destroying the shared session. A persisted upload-limit change is
applied to the transport only after the daemon restarts.

## Pairing

Pairing is the one-time exchange that lets a GM browser become a bridge. Its guarantees:

- a pending request is bound to the socket that made it and disappears when that socket closes;
- pairing codes expire after a bounded interval;
- the daemon persists only a digest of the bridge credential; the clear credential is delivered
  exactly once, to the requesting socket, only after the digest has been persisted;
- approving the same Origin/world/user/client again re-pairs that client's existing profile by
  rotating its credential instead of accumulating duplicates;
- expiry, denial, socket close, and a granted pairing all end the attempt through one idempotent
  path, so the browser-side authorization UI is never left waiting after daemon shutdown or expiry.

### Client identity

The pairing request carries a `client` object inside its identity: `id` is the browser's persistent
client identifier, and `label` is a human name for that browser. Pairing records are unique per
(Origin, world, user, client id), so two browsers signed in as the same GM on the same world hold two
independent records and neither re-pair disturbs the other.

- `id` is bounded to hexadecimal characters and dashes, 8 to 64 characters long.
- `label` is 1 to 64 characters of Unicode text. Whitespace-only values are rejected, as are control
  (C0/C1), zero-width, bidirectional-override, and Unicode tag characters. The schema is the
  enforcement point because any local process can send a pairing request and the label is later
  printed by `auth list` and `auth pending`.
- Labels are not unique. Duplicate labels are accepted as they arrive, without suffixing.
- A label is chosen once, in the browser, at pairing time. No control operation renames a stored
  record; re-pairing is the way to change a label.

The bridge hello carries `clientId` at the top level, beside `pairingId` and `credential`, because it
is authentication material rather than session content: the daemon rejects a hello whose client id
does not match the stored pairing. The label is not resent on hello — the daemon's pairing record owns
it, and the browser keeps a copy only to display it.

## Daemon control

Authenticated local clients manage pairings and the active bridge through closed,
operation-discriminated control requests; responses repeat both the correlation id and the
operation. The operation registry lives in the protocol package. `auth.approve` takes only an
optional pairing `code`; the approved record's label comes from the pairing request itself.

`auth.await` is the long-poll behind the interactive pairing wait. It answers at once with the
earliest live pending request, in the same public shape `auth.pending` serializes and with no
credential material; when nothing is pending it parks the response until a request arrives, or until a
bounded daemon-side cap elapses and the result carries no request. Every parked waiter is answered by
the next arriving request, and a waiter is discarded when its client socket closes. The cap is the
invariant that keeps a parked response inside the caller's own request timeout; `timeoutMs` may ask
for a shorter park and is bounded by the cap, so no caller can park longer than the daemon allows.

`auth.prune` deletes idle pairing records. Its optional `olderThanDays` is a non-negative integer and
defaults to 30; a record is removed when its `lastSeenAt` is older than that many days before the
call. `lastSeenAt` is stamped when a pairing is approved, when its browser passes the bridge hello,
again when that bridge connection closes, and when a hello whose credential the daemon accepted is
rejected with `BRIDGE_BUSY`, so the cutoff measures how long a record has been idle rather than how
long ago it last connected. A hello rejected with `UNAUTHORIZED` proves nothing about the record and
never stamps it. The pairing that owns the active bridge, and the holder of a live
abnormal-disconnect lease, are excluded from removal regardless of their timestamps, so pruning can
never unpair the browser that is connected or the one the daemon is still holding a slot for. The
config is rewritten only when at least one record is removed. The result is `{ olderThanDays, pruned }`,
where `olderThanDays` is the cutoff the daemon applied — including the default when the caller omitted
it — and `pruned` carries the removed records in the same public, digest-free shape `auth.list`
serializes. The daemon computes the set at execution time; a caller that previewed candidates from
`auth.list` holds an advisory list, not the outcome, and the executed set may be wider than that
preview when a record crosses the cutoff between the two calls.

The active bridge itself may use
exactly one control operation: revoking its own pairing. A browser Unpair deletes its stored
credential only after a correlated successful revocation; on failure the credential is retained for
retry, and discarding it locally is a separate deliberate action.

## Bridge sessions

After Foundry is ready, the module presents its pairing identity, client identifier, world, user,
versions, and the command set it can execute; the daemon forwards only commands advertised by the
active session.

- Authentication or protocol-version rejection is terminal for that module load, so a persistent
  configuration problem does not become a reconnect loop.
- A session that completed its handshake and later loses transport reconnects with bounded
  exponential backoff.
- `BRIDGE_BUSY` is terminal for that client instance but preserves the stored credential; the
  operator releases the current owner and retries explicitly rather than pairing again.
- Only the exact active authenticated socket can release ownership with a goodbye.
- A same-pairing takeover immediately completes requests owned by the displaced socket with an
  indeterminate-delivery error: the operation may already have committed, so callers inspect world
  state before retrying.
- If the connected user loses GM authority, the bridge answers the pending command with a
  correlated `PERMISSION_DENIED` without dispatching it, so the caller knows the rejected command
  started no mutation.

## Commands and correlation

Commands are explicit typed names registered in the protocol package; there is no generic RPC
method. A request carries a caller-chosen correlation id and schema-validated parameters, validated
in the CLI before connecting and again in the bridge before dispatch. The command must be both
registered and advertised by the active bridge. The response repeats the correlation id and is
exclusive: success carries a result, failure carries a structured error.

## Result conventions

Document results live under a type-named key inside the result. Collection, action, and bulk
results use their documented keys, which vary between commands but are stable for each one.
Serialized projections expose `id` as the public identifier; a source `_id` mirror may accompany
it. A previewed new document has no persistent identity, and an id observed during a preview must
not be reused. List-like responses that paginate return their collection with a total and a
has-more flag, and filters apply before pagination.

## Dry run

Mutation commands accept a dry-run request that passes through validation, resolution,
sanitization, permission checks, capability checks, and preparation, then returns before
persistence using the normal result shape with an explicit dry-run marker. Only values knowable
before execution are reported: random selection, rendering, hooks, and other execution-dependent
observations may be absent or explicitly unconfirmed. A successful preview reserves nothing — the
world can change between preview and commit.

## Idempotency

Commands with duplicate-creation or non-repeatable-action risk accept or require an idempotency
key identifying one logical request. Reusing a key with a different command or payload is rejected
as `IDEMPOTENCY_KEY_CONFLICT`. Idempotency memory is runtime state: bounded, and cleared by daemon
restart, bridge replacement, world switch, expiry, or eviction. It reduces duplicate effects across
response loss; it is not a durable transaction, so an indeterminate delivery still ends with a
world-state read.

## Batch requests and bulk writes

Connection reuse (`exec --stdin`) is a client mechanism: each request keeps its own correlation id
and success state, and failures are reported per request. Bulk write commands are ordinary typed
commands over bounded arrays: elements are prevalidated, but Foundry persistence is not
transactional, so the result reports overall completeness plus a per-element outcome, and every
outcome carries its own meaning.

## Error model

Errors have a stable code, a human-readable message, and optional structured details. The code and
documented detail fields are the stable contract for branching; message text is not. The exhaustive
code set is exported by the protocol package. The classes consumers act on:

| Class | Representative codes | Consumer response |
|---|---|---|
| Request/schema | `INVALID_PARAMS`, `UNKNOWN_COMMAND` | Correct the request or resolve version skew |
| Authentication/permission | `UNAUTHORIZED`, `PERMISSION_DENIED` | Restore credentials or authority |
| Pairing | `PAIRING_REQUIRED`, `PAIRING_EXPIRED`, `BRIDGE_BUSY` | Pair, retry revocation, or release the active owner as indicated |
| Lookup | `*_NOT_FOUND` | Refresh ids and world state |
| Safety/policy | `DELETE_FORBIDDEN`, `PATH_NOT_ALLOWED` | Change the requested operation |
| Capability | `UNSUPPORTED_OPERATION` | Choose a supported workflow or runtime |
| Size/resource | `PAYLOAD_TOO_LARGE`, `QUERY_TOO_BROAD` | Reduce or page the request |
| Command policy | `COMMAND_DENIED` | Treat the command as unavailable on that GM client |
| Approval | `APPROVAL_PENDING`, `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, `APPROVAL_CANCELLED`, `APPROVAL_QUEUE_FULL`, `APPROVAL_UNKNOWN` | Apply the approval rules below |
| Bridge state | `BRIDGE_NOT_READY`, `BRIDGE_TIMEOUT`, `BRIDGE_DISCONNECTED` | Apply the delivery rules below |
| Unexpected | `INTERNAL_ERROR` | Preserve details and investigate |

Foundry DataModel validation failures surface as parameter errors and are distinguished in details
where available. A failed nested lookup identifies the level that failed.

`UNSUPPORTED_PROTOCOL_VERSION` details carry `expectedVersion`, `actualVersion`, the `handshake` that
refused the message, and `staleComponent` — `module`, `cli-daemon`, or `unknown` — so a consumer can
name the half that has to be updated. The ordering is the comparison described under versioning;
`unknown` is reported whenever a version cannot be ordered or the peer is unidentified, in place of a
guess.

With JSON output, a failed command emits one structured error envelope on stdout and exits
non-zero. The exit code is a coarse process classification; the structured error code is the
authoritative automation signal. `exec --stdin` reports per-line errors and uses its own aggregate
exit status.

## Approval flow

A GM client's command policy can require human approval before a command runs. An approval is a
decision about one invocation, taken by the GM in Foundry: it is unrelated to pairing, and it is not
the post-write confirmation that a mutation persisted. The policy that governs an invocation belongs
to the GM client holding the bridge.

The wait is two-phase, because a decision can outlast any request timeout:

- The ordinary request is answered at once with `APPROVAL_PENDING`, whose details carry `approvalId`,
  `expiresAt` in epoch milliseconds, and `command`. The request is not held open, so a decision taken
  an hour later does not depend on one socket surviving. That the phase-one answer is an error
  envelope is deliberate: a consumer that does not implement the wait loop fails safe instead of
  reporting success. The CLI is the supported consumer of this flow and converts the pending answer
  into a blocking wait, so a caller using the CLI never branches on the code itself.
- `approval.await { approvalId, waitMs? }` polls that id. A poll parks in the Foundry module for at
  most `APPROVAL_AWAIT_PARK_CAP_MS`; its optional `waitMs` may ask for a shorter park and is bounded
  by the cap. The result echoes the id and is either
  `{ approvalId, status: "pending", expiresAt? }` or `{ approvalId, status: "resolved", outcome,
  response? }`. The deadline is reported while the decision is still open; an approved command that is
  already running can no longer time out, and its answer carries no deadline.
- The terminal outcomes are `approved`, `denied`, `timeout`, and `cancelled`. `approved` carries the
  original command's full outcome — success or handler error — as `response`, so the caller learns
  what a direct call would have returned. That envelope belongs to the approval rather than to the
  request that was answered with `APPROVAL_PENDING`, so its `id` is the `approvalId`. `denied`,
  `timeout`, and `cancelled` mean the command was not executed and the same request is safe to send
  again; they reach the caller as `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, and `APPROVAL_CANCELLED`.
- A terminal outcome is not consumed by the first waiter. It stays available for
  `APPROVAL_RESULT_RETENTION_MS`, which covers a lost poll response and several waiters on one id,
  and then expires. That window is what a bounded store offers rather than a promise it can keep
  under pressure: an outcome already handed to a poll is the first one the store forgets when a
  later request needs the room, so a repeated poll can answer `APPROVAL_UNKNOWN` before the window is
  over. An outcome is only counted as handed out once its answer has had time to reach the client, so
  a poll repeated immediately after a lost response still finds it. An outcome no client has read yet
  is never traded away at all.
- `approval.cancel { approvalId }` asks for a still-pending decision to be abandoned and answers
  `{ approvalId, status }`, where `status` is `cancelled`, `executing`, `resolved`, or `unknown`. Only
  `cancelled` guarantees that the command will not run: `executing` means the GM's decision already
  won the race, and a started handler cannot be recalled. `resolved` means the decision was taken
  before the cancellation arrived, and the outcome it settled on is still retained, so one further
  `approval.await` reads the real verdict rather than leaving the call indeterminate.
- `APPROVAL_QUEUE_FULL` is admission control. The bounded store refused the request before anything
  was displayed or executed, so nothing ran. Its details carry the `command` and the `reason` the
  admission was refused: `pending-count` and `pending-bytes` for the number and the combined weight
  of the decisions still awaiting the GM, and `retained-count` when room could only have been made by
  discarding a retained outcome no client has read yet. The weight is the size of the received request
  frame, measured once from the frame as received; a frame whose size could not be established is
  refused as though it exceeded the budget, because an unweighed request cannot be held to one.
- `APPROVAL_UNKNOWN` answers an id the module has no approval state for. Approval state is runtime
  state: it does not survive a GM client reload, and it is released whenever that client's bridge
  session ends with no reconnect to follow — disconnecting, unpairing, losing the bridge slot to
  another client, a refused handshake, or a connection rebuilt from the settings window — because the
  decisions that session held can no longer be reached. The transport's own reconnect after a dropped
  socket keeps them. A retained outcome expires as well. The answer is indeterminate — the command may
  never have started or may have completed — so world state is the only authority, and a read comes
  before any re-request.
- A dry run is not gated by an approval: the preview of an approval-listed command runs without a
  decision and its result carries `approvalRequired: true`, so the caller knows the real call
  reaches the GM. A command the policy denies is refused in preview too, and that refusal is an
  error envelope with no result at all.
- `policy.snapshot` takes no parameters and reports the effective policy as
  `{ approve: [names], deny: [names] }`, resolved by the same rules the dispatch-time gate applies.
  It is advisory; the policy can change between the snapshot and the next call, and the gate at
  dispatch time is the authority.

An `approvalId` is an opaque token the pending answer supplies rather than a value a caller
constructs, and all three request schemas are closed, so an unrecognized parameter is rejected
before the command is dispatched. `approval.await`, `approval.cancel`, and `policy.snapshot` are CLI
plumbing rather than world-editing commands, so the discovery surfaces omit them: they are absent
from the `commands` listing, from the command inventory in `system.info`, and from the session
command set the daemon echoes in bridge status, while `schema <command>` still returns their request
schemas. The handshake set is deliberately wider than those surfaces, because it is the daemon's
forwarding gate rather than a display: a session advertises every command it can execute, including
the plumbing, and a command missing from that set is unreachable.

An idempotency key spans both phases. When a keyed request is answered with `APPROVAL_PENDING`, the
daemon remembers which approval that key created, in the same scope and with the same in-memory
lifetime as its ordinary idempotency cache. A byte-identical retry of the same key is answered with
the same pending answer, so a caller that lost the first one rejoins the decision already waiting
instead of asking the GM twice; a different payload under that key is the usual
`IDEMPOTENCY_KEY_CONFLICT`. When the decision settles, the daemon promotes an approved outcome —
success or handler error alike, because execution started — to the key's cached final response, and
drops the link after a denial, a timeout, or a confirmed cancellation so that re-sending the same
key is a fresh request. A cancellation that arrives after the decision was taken settles
nothing on its own: the link stays whole so that the poll reading the real verdict promotes or drops
it. An outcome that could not be read leaves the key indeterminate: retrying it
answers `APPROVAL_UNKNOWN` until the link expires, because the daemon cannot say whether the command
ran. That is a verify-then-act state, and the way out of it is a world-state read followed by a
fresh key.

The link is runtime state with the same limits as the idempotency cache: a daemon restart, a switch
to another world or pairing, and expiry all forget it. A retry after one of those reaches Foundry as
a new request, so an indeterminate delivery still ends with a read rather than a blind retry.

## Delivery states and retries

Retry safety is a function of whether the request reached Foundry:

| Condition | Forwarded to Foundry? | Retry meaning |
|---|---:|---|
| Client could not connect | No | Safe to retry after restoring the daemon |
| `BRIDGE_NOT_READY` | No | Safe to retry after a bridge connects |
| Response timeout after send | Possibly | May have committed; inspect state or reuse the same idempotency key |
| `BRIDGE_TIMEOUT` | Yes | May have committed; inspect state or reuse the same idempotency key |
| `BRIDGE_DISCONNECTED` | Yes or in flight | May have committed; inspect state |
| `COMMAND_DENIED` | Refused before dispatch | Not executed; the command is unavailable on that GM client |
| `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, `APPROVAL_CANCELLED` | Reached Foundry, never dispatched | Not executed; the same request is safe to send again |
| `APPROVAL_QUEUE_FULL` | Refused before admission | Not executed; safe to retry when the waiting decisions clear |
| `APPROVAL_UNKNOWN` | Unknown | May have committed; inspect state, then re-request under a fresh idempotency key |
| Structured command rejection | Resolved with an error | Correct according to the code |

The distinction between connection-phase and response-wait failures is carried in structured error
details. Default waits, forward timeouts, heartbeats, and backoff bounds are defined in the
protocol and CLI constants; runtime flags can override the client and daemon request timeouts.

## Compatibility rules

- One release ships the CLI, the daemon, and the Foundry module as a compatible set, and the protocol
  version they share is that release's version. Mixed-release operation is refused rather than
  supported, so there is no negotiated subset to reason about.
- Within a release line, additive result and handshake fields are how the contract evolves without
  changing the meaning of existing fields; request schemas remain explicit and versioned.
- A bridge advertises the command set it can execute; the daemon forwards only advertised commands.
- Unsupported version-dependent behavior produces a predictable error rather than a false success.

Foundry-version behavior belongs in [Foundry compatibility](compatibility.md), while per-command
request shape remains discoverable from the registry.
