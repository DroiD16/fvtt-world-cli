# Protocol

This reference defines the integration contract between local clients, the daemon, and the
Foundry bridge. For CLI workflows, use [Commands](commands.md).

Exact command and frame schemas come from the [protocol registry](../packages/protocol/src/commands.js)
and [family schemas](../packages/protocol/src/schemas/). The [constants](../packages/protocol/src/constants.js)
define error codes, timeouts, and limits. Inspect the installed version with `commands --json` and
`schema <command>`; use `system info --json` for connected-runtime details.

## Versioning

The protocol version equals the product release version. Every transport message carries it, and all
components in one installation must match exactly. The daemon and Foundry module reject a mismatch
instead of negotiating a subset of the contract.

## Transport model

The daemon listens on a loopback WebSocket endpoint. Credentials never appear in URLs. A local
client has no browser Origin and authenticates with `client.hello` as its first message. Browser
sockets require an exact HTTP(S) Origin and may only request pairing or a bridge session.

The daemon imposes a first-frame deadline and assigns no role before authentication succeeds.
Every message has a closed top-level schema. Malformed openings close immediately; later malformed
messages return `INVALID_MESSAGE` where possible. An authenticated local client may continue after
a correlated control-request error.

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
- expiry, denial, socket close, and daemon shutdown end the pending attempt.

### Client identity

Pairing identity includes a `client` object with a persistent `id` and human-readable `label`.
Records are unique per Origin, world, user, and client id. Re-pairing one browser does not affect
another browser using the same GM account.

- `id` accepts 8 to 64 hexadecimal characters and dashes.
- `label` accepts 1 to 64 Unicode characters, excluding whitespace-only values, C0/C1 controls,
  zero-width characters, bidirectional controls, and Unicode tags.
- Labels need not be unique. Changing a stored label requires re-pairing.

The bridge hello carries `clientId`, `pairingId`, and `credential`. A client id mismatch returns
`UNAUTHORIZED`. The label is not resent; the stored pairing owns it.

## Daemon control

Authenticated local clients manage pairings and bridge ownership through closed control requests.
Responses repeat the correlation id and operation. The protocol package defines the operation
registry; the [command guide](commands.md#authorization-commands) covers operator use.

`auth.await` returns the earliest live pending request in the public `auth.pending` shape, without
credentials. With no pending request, it parks until one arrives or a bounded wait expires with an
empty result. `timeoutMs` can shorten but not exceed the daemon's poll cap. A new request answers
all parked waiters; socket closure removes that client's waiter.

`auth.prune` accepts a non-negative `olderThanDays`, defaulting to 30. It removes records older than
the cutoff according to `lastSeenAt`, excluding the active pairing and a live reconnect-lease
holder. Approval, authenticated hellos, and disconnects refresh this timestamp. A valid hello
rejected with `BRIDGE_BUSY` refreshes it; an unauthorized hello does not.

The result is `{ olderThanDays, pruned }`, with removed records in the public `auth.list` shape.
The daemon computes the set at execution time, so an earlier candidate list is advisory and can
omit a record that later crosses the cutoff.

The active authenticated bridge may use only one control operation: revoking its own pairing.
It deletes its local credential only after a correlated successful revocation response. A failed
revocation retains the credential for retry.

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
- Another pairing cannot displace the active bridge. A same-pairing connection may take over;
  requests forwarded to the displaced socket then fail with indeterminate delivery.
- A clean goodbye releases ownership immediately. An abnormal close reserves it briefly for the
  same pairing. A daemon-initiated release clears ownership and stops automatic reconnects.
- If the connected user loses GM authority, the bridge answers the pending command with a
  correlated `PERMISSION_DENIED` without dispatching it, so the caller knows the rejected command
  started no mutation.

## Client-side status signal

The module emits `fvtt-world-cli.statusChanged` for macros and other modules in the GM client.
It fires when transport status or handshake acknowledgement changes and receives the same bridge
snapshot exposed by `system info`:

`status`, `url`, `helloAcknowledged`, `hasEstablishedSession`, `lastConnectedAt`,
`reconnectAttempts`, `terminalStopReason`, and `protocolVersionMismatch`.

Readiness requires both `status === "connected"` and `helloAcknowledged`. The socket opens before
the daemon acknowledges the handshake, and losing it clears the acknowledgement.
`protocolVersionMismatch` is normally `null`; on a mismatch it reports both versions and identifies
the older component as `module`, `cli-daemon`, or `unknown`.

This hook is local to the GM client. Credential changes do not trigger it, and it has no wire
protocol meaning.

## Commands and correlation

A request supplies a caller-chosen correlation id, a registered command name, and schema-validated
parameters. Responses repeat the id and carry either a result or an error. Validate both the
request envelope and command parameters against the protocol registry.

### Request and response example

After the local client has authenticated, it can send this request to the daemon. Replace
`<release-version>` with the installed protocol version. The active bridge must advertise the command.

```json
{
  "protocolVersion": "<release-version>",
  "type": "command.request",
  "id": "check-bridge",
  "command": "system.ping",
  "params": {}
}
```

A success response repeats the id and carries the result. This example omits the timestamp and
bridge-status fields inside `result`:

```json
{
  "protocolVersion": "<release-version>",
  "type": "command.response",
  "id": "check-bridge",
  "ok": true,
  "result": { "pong": true }
}
```

If no bridge is ready, the response instead carries an error. Message wording is illustrative:

```json
{
  "protocolVersion": "<release-version>",
  "type": "command.response",
  "id": "check-bridge",
  "ok": false,
  "error": {
    "code": "BRIDGE_NOT_READY",
    "message": "No Foundry bridge is connected."
  }
}
```

The protocol package exports `REQUEST_SCHEMA` and `COMMAND_RESPONSE_SCHEMA` for envelope validation.

## Result conventions

Document results use type-named keys and expose `id` as the public identifier. A source `_id`
mirror may accompany it. List responses use smaller projections than single-document reads;
filters apply before pagination. Previewed documents have no persistent identity, so an id
observed during a preview must not be reused.

Broadcast actions report `dispatched` and target users rather than a confirmed player-side result.
The active/inactive split is included where knowable.

### Macro results

`macro.execute` returns the macro's value and observed chat messages. `chatCapture` describes the
observation: `captured` for all expected messages, `not-created` when a chat macro created none,
`partial` for incomplete capture, or `unknown` when the client could not observe the chat log.

`MACRO_TIMEOUT` is indeterminate because the macro keeps running. A thrown error can follow partial
effects, while a macro that catches its own errors may return normally. Consumers must verify
world state when the return value does not establish the effect.

### Setting results

Setting writes return the observed `value` and its `previous` value. Registered types or callbacks
may normalize the input. Confirmation establishes that the previous value changed, not that the
requested value was stored exactly. Writing an already-stored value succeeds as unchanged without
calling Foundry. `requiresReload: true` indicates that the GM client needs a reload.

## Write confirmation

Document writes report success only after confirmation. Foundry can resolve a vetoed or invalid
write without throwing, and hooks can remove or rewrite part of a patch. Single and bulk updates
pass Foundry a private copy, then compare stored state with the original request.

A valid patch whose requested state is already stored remains a successful no-op. A validation
failure recovered after an unwritten update returns `INVALID_PARAMS`. Unconfirmed, partial, or
indeterminate updates can return `INTERNAL_ERROR` with these details:

- `fields`: requested fields whose state was not confirmed.
- `partial: true`: stored data changed in a requested field, but the full requested state was
  not reached. A hook may have applied only part of a nested object or replaced a value.
- `changedFields`: requested top-level fields observed to change, including fields that changed
  only in part. This does not attribute the change to this request rather than a concurrent write.
- `appliedFields`: changed top-level fields whose requested state was confirmed. This can be empty
  even when `partial` is true.
- `indeterminate: true`: confirmation could not establish the outcome. Some or all of the write
  may have persisted. `changedFields` is `null` when the before/after comparison was unavailable.

Parent patches that create embedded entries without `_id`, such as new `behaviors` in
`scene.region.update`, return an indeterminate error after writing because parent update results
cannot confirm those creations. A retry may duplicate them. Read the embedded collection first,
or use a dedicated embedded create command. Dry runs can still preview these patches.

After partial or indeterminate errors, read stored state and submit only remaining changes as a
new operation with a fresh idempotency key if using one.

### Patch shape checks

Single updates, bulk updates, and dry runs reject ambiguous field spellings, invalid or discarded
array values, and dotted writes inside arrays with `INVALID_PARAMS` before mutation. Recognized
legacy fields are checked against their migrated destinations as well. Send whole arrays; ordinary
dotted object-property writes remain supported where the schema permits them.

Errors identify the `field` and may include `arrayField`, `requested`, `stored`, or migration
destination details. Bulk failures add the entry's `index` and `id`; single failures use document
coordinates. These details describe a rejected patch, not a write result.

## Dry run

Mutation commands accept a dry-run request that passes through validation, resolution,
sanitization, permission checks, capability checks, and preparation, then returns before
persistence using the normal result shape with an explicit dry-run marker. Only values knowable
before execution are reported: random selection, rendering, hooks, and other execution-dependent
observations may be absent or explicitly unconfirmed. A successful preview reserves nothing; the
world can change between preview and commit.

## Idempotency

An idempotency key identifies one logical request. Reusing it with another command or payload
returns `IDEMPOTENCY_KEY_CONFLICT`. The cache is bounded and temporary; it cannot guarantee exactly
once execution across state loss. Keys remain subject to the [delivery rules](#delivery-states-and-retries).

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
- Daemon restart, world switch, pairing switch, and expiry clear runtime idempotency state. Cached
  successes may also be evicted. Later requests can then reach Foundry as new operations.

## Batch requests and bulk writes

[`exec --stdin`](commands.md#send-a-batch-of-commands) is a CLI wrapper over individual requests.
Its input ids and line indexes belong to CLI output, not the wire contract.

Bulk writes accept bounded arrays and prevalidate their elements. Persistence is not transactional;
results report `complete` and per-element `outcomes`, all of which the caller must inspect.

`get-many` fails the request if any requested id cannot be read. `setting.get-many` is the exception;
it reports an unregistered key as `SETTING_NOT_FOUND` on that row without failing the whole request.

## Error model

Errors carry a stable `code`, a human-readable `message`, and optional `details`. Branch on codes
and documented detail fields, not message text. The [constants](../packages/protocol/src/constants.js)
export the code set. CLI exit codes are coarse classifications; the JSON error is authoritative.

Validation errors identify invalid parameters; nested lookup failures identify the failed level.
Approval and delivery errors need the [retry rules](#delivery-states-and-retries), since a failure
does not always mean that nothing ran.

`UNSUPPORTED_PROTOCOL_VERSION` details contain `expectedVersion`, `actualVersion`, `handshake`,
and `staleComponent`. The last field identifies the older component as `module`, `cli-daemon`,
or `unknown` when the peer or version ordering cannot be established.

## Approval flow

A GM client's policy can hold an invocation for approval before dispatch. Pairing approval grants
a browser credential; command approval permits an invocation; confirmation checks a completed write.
See [Security](security.md#permissions-and-destructive-actions) for policy and review limits.

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
- For `macro.execute`, approval binds the body and type captured at admission. Drift or a missing
  capture prevents execution and returns `APPROVAL_STALE` in the approved outcome's `response`.
  Drift details include `macroId`, `requestedMacroId`, and `drifted`, which names `body`, `type`,
  `existence`, or `identity`. A missing capture returns details with `command` instead. Read the
  current macro before a fresh request, using a new idempotency key because the refusal can be
  cached. No new approval is created automatically.
- A dry run bypasses approval and reports `approvalRequired: true` when the real command would wait.
  The policy still refuses denied commands during a dry run.
- `policy.snapshot` reports `{ approve: [names], deny: [names] }`. The result is advisory because the
  policy can change before dispatch.

The module supplies each opaque `approvalId`; callers do not construct one. Approval request schemas
are closed. `approval.await`, `approval.cancel`, and `policy.snapshot` do not appear in `commands`,
`system.info` command inventory, or bridge status. `schema <command>` still returns their schemas.
The bridge handshake advertises them because the daemon must forward them.

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
| `APPROVAL_STALE` | Allowed, refused before dispatch | Not executed; read the macro and request fresh approval with a new idempotency key if using one |
| `IDEMPOTENCY_STORE_FULL` | No | Not executed; safe to retry when earlier keys settle or expire |
| `APPROVAL_UNKNOWN` | Unknown | May have committed; inspect state, then re-request under a fresh idempotency key |
| Update error with `partial` or `indeterminate` details | Yes | Read stored state; send only remaining changes as a new operation |
| Structured command rejection | Resolved with an error | Correct according to the code |

The distinction between connection-phase and response-wait failures is carried in structured error
details. Default waits, forward timeouts, heartbeats, and backoff bounds are defined in the
protocol and CLI constants; runtime flags can override the client and daemon request timeouts.
