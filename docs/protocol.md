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

The protocol version equals the product release version. Every transport message carries it, and all
components in one installation must match exactly. The daemon and Foundry module reject a mismatch
instead of negotiating a subset of the contract.

Recover by updating the older component. Restart the daemon after updating the CLI package, or reload
the GM client after updating the Foundry module. A refused module load does not reconnect on its own.
Mismatch errors identify the older component when the two versions can be ordered.

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
Broadcast commands that change no document — pulling users to a scene, showing a journal entry or
image — report `dispatched` rather than a confirmed post-state, because a socket broadcast offers
nothing to read back; the result names the users it targeted and the active/inactive split where
that is knowable. `macro.execute` reports the macro's returned value and observed chat messages,
and a timeout there is indeterminate: the macro keeps running in the GM client, so `MACRO_TIMEOUT`
callers verify effects by reads instead of retrying blindly.
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
restart, bridge replacement, world switch, or expiry. The daemon may also evict cached successes.
Idempotency reduces duplicate effects across response loss. It is not a durable transaction, so an
indeterminate delivery still ends with a world-state read.

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
| Lookup | `*_NOT_FOUND`, `SETTING_UNREGISTERED` | Refresh ids and world state |
| Safety/policy | `DELETE_FORBIDDEN`, `PATH_NOT_ALLOWED`, `SETTING_PROTECTED`, `USER_SELF_PROTECTED` | Change the requested operation |
| Capability | `UNSUPPORTED_OPERATION` | Choose a supported workflow or runtime |
| Size/resource | `PAYLOAD_TOO_LARGE`, `QUERY_TOO_BROAD`, `IDEMPOTENCY_STORE_FULL` | Reduce, page, or resend the request later |
| Command policy | `COMMAND_DENIED` | Treat the command as unavailable on that GM client |
| Approval | `APPROVAL_PENDING`, `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, `APPROVAL_CANCELLED`, `APPROVAL_QUEUE_FULL`, `APPROVAL_UNKNOWN` | Apply the approval rules below |
| Bridge state | `BRIDGE_NOT_READY`, `BRIDGE_TIMEOUT`, `BRIDGE_DISCONNECTED` | Apply the delivery rules below |
| Indeterminate outcome | `MACRO_TIMEOUT` | Verify the effect by reads before retrying |
| Unexpected | `INTERNAL_ERROR` | Preserve details and investigate |

Foundry DataModel validation failures surface as parameter errors and are distinguished in details
where available. A failed nested lookup identifies the level that failed.

`UNSUPPORTED_PROTOCOL_VERSION` details carry `expectedVersion`, `actualVersion`, the rejecting
`handshake`, and `staleComponent`. The component is `module`, `cli-daemon`, or `unknown`. Consumers
can name the component that needs an update when the comparison identifies it. An unordered version
or unidentified peer produces `unknown`.

With JSON output, a failed command emits one structured error envelope on stdout and exits
non-zero. The exit code is a coarse process classification; the structured error code is the
authoritative automation signal. `exec --stdin` reports per-line errors and uses its own aggregate
exit status.

## Approval flow

A GM client's command policy can require approval before a command runs. Approval is the GM's
decision about one invocation. Pairing approval grants a browser credential, while confirmation
checks a completed write. The active GM client's policy controls the invocation.

The wait has two phases because the decision can outlast a normal request timeout:

- The original request returns `APPROVAL_PENDING`. Its details contain `approvalId`, `expiresAt` in
  epoch milliseconds, and `command`. A consumer without approval support stops on this error. The CLI
  converts it into a blocking wait.
- `approval.await { approvalId, waitMs? }` asks for the current state. `waitMs` cannot exceed
  `APPROVAL_AWAIT_PARK_CAP_MS`. The result is either
  `{ approvalId, status: "pending", expiresAt? }` or
  `{ approvalId, status: "resolved", outcome, response? }`. Once execution starts, the approval can
  no longer expire.
- Terminal outcomes are `approved`, `denied`, `timeout`, and `cancelled`. An approved outcome carries
  the command response, including handler errors, and uses the approval identifier as its envelope
  `id`. The other outcomes mean the command did not run. The CLI reports them as `APPROVAL_DENIED`,
  `APPROVAL_TIMEOUT`, or `APPROVAL_CANCELLED`.
- The module retains terminal outcomes for bounded repeat reads. It may discard an outcome after a
  client has read it, but it does not discard an unread outcome to admit a new request. A later read
  of discarded state returns `APPROVAL_UNKNOWN`.
- `approval.cancel { approvalId }` returns `cancelled`, `executing`, `resolved`, or `unknown`. Only
  `cancelled` proves that the command will not run. Use `approval.await` after `resolved` to read the
  decision.
- `APPROVAL_QUEUE_FULL` means the module refused admission before display or execution. Its `reason`
  is `pending-count`, `pending-bytes`, or `retained-count`. The request is safe to retry after earlier
  approvals clear.
- `APPROVAL_UNKNOWN` means the module no longer holds that approval. Reloading the GM client, ending
  its bridge session, or expiry can remove the state. The command may not have started, or it may have
  completed. Read world state before another write.
- A dry run bypasses approval and reports `approvalRequired: true` when the real command would wait.
  The policy still refuses denied commands during a dry run.
- `policy.snapshot` reports `{ approve: [names], deny: [names] }`. The result is advisory because the
  policy can change before dispatch.

The module supplies each opaque `approvalId`; callers do not construct one. Approval request schemas
are closed. `approval.await`, `approval.cancel`, and `policy.snapshot` do not appear in `commands`,
`system.info` command inventory, or bridge status. `schema <command>` still returns their schemas.
The bridge handshake advertises them because the daemon must forward them.

An idempotency key covers the request and its approval:

- After `APPROVAL_PENDING`, the daemon links the key to that approval. A byte-identical retry returns
  the same pending response. A different request with that key returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- An approved outcome becomes the cached final response. A denial, timeout, or confirmed
  cancellation removes the link, so the same request can start a new approval.
- If the daemon cannot read the approval outcome, the key remains indeterminate and returns
  `APPROVAL_UNKNOWN` until expiry. Read world state before retrying under a fresh key.
- If a bridge session ends before the daemon receives the first response, the daemon retains the key
  as lost in flight. Reuse returns `BRIDGE_DISCONNECTED` with `reason: "lost-in-flight"`. Read world
  state, then use a fresh key if the operation still needs to run.
- The daemon reserves bounded space before forwarding a keyed request. If no slot is available, it
  returns `IDEMPOTENCY_STORE_FULL` before Foundry receives the request. Retry after earlier keys
  settle or expire.
- Daemon restart, world switch, pairing switch, and expiry clear runtime idempotency state. A later
  request can reach Foundry as a new operation, so an indeterminate result still requires a state
  read first.

## Delivery states and retries

Retry safety is a function of whether the request reached Foundry:

| Condition | Forwarded to Foundry? | Retry meaning |
|---|---:|---|
| Client could not connect | No | Safe to retry after restoring the daemon |
| `BRIDGE_NOT_READY` | No | Safe to retry after a bridge connects |
| Response timeout after send | Possibly | May have committed; inspect state or reuse the same idempotency key |
| `BRIDGE_TIMEOUT` | Yes | May have committed; inspect state or reuse the same idempotency key while that bridge session lasts |
| `BRIDGE_DISCONNECTED` | Yes or in flight | May have committed; inspect state, then re-request under a fresh idempotency key |
| `COMMAND_DENIED` | Refused before dispatch | Not executed; the command is unavailable on that GM client |
| `APPROVAL_DENIED`, `APPROVAL_TIMEOUT`, `APPROVAL_CANCELLED` | Reached Foundry, never dispatched | Not executed; the same request is safe to send again |
| `APPROVAL_QUEUE_FULL` | Refused before admission | Not executed; safe to retry when the waiting decisions clear |
| `IDEMPOTENCY_STORE_FULL` | No | Not executed; safe to retry when earlier keys settle or expire |
| `APPROVAL_UNKNOWN` | Unknown | May have committed; inspect state, then re-request under a fresh idempotency key |
| Structured command rejection | Resolved with an error | Correct according to the code |

The distinction between connection-phase and response-wait failures is carried in structured error
details. Default waits, forward timeouts, heartbeats, and backoff bounds are defined in the
protocol and CLI constants; runtime flags can override the client and daemon request timeouts.

## Compatibility rules

- One release ships the CLI, daemon, and Foundry module as a compatible set. They share that release's
  version. The bridge refuses mixed-release operation and does not negotiate a subset.
- Within a release line, additive result and handshake fields are how the contract evolves without
  changing the meaning of existing fields; request schemas remain explicit and versioned.
- A bridge advertises the command set it can execute; the daemon forwards only advertised commands.
- Unsupported version-dependent behavior produces a predictable error rather than a false success.

Foundry-version behavior belongs in [Foundry compatibility](compatibility.md), while per-command
request shape remains discoverable from the registry.
