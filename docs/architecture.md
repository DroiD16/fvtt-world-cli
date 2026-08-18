# Architecture

fvtt-world-cli is a monorepo containing a command-line client, a local daemon, a shared protocol,
and a Foundry module. The components share contracts but have distinct runtime responsibilities.

## Runtime roles

### CLI

`packages/cli` owns:

- command parsing and help;
- local configuration;
- local request-schema validation;
- WebSocket client transport;
- JSON and human-readable output;
- local discovery commands;
- reading explicitly supplied operator files for upload or macro input.

The CLI does not load Foundry or mutate world storage. It converts CLI flags into typed protocol
requests and presents structured responses.

### Daemon

The daemon runs as part of the CLI package and owns:

- the loopback WebSocket listener;
- device-local client authentication and the persistent pairing registry;
- the single active bridge session;
- request correlation and forwarding;
- forward timeouts and heartbeat state;
- transport size limits;
- runtime idempotency coordination and caching.

The daemon does not interpret Foundry document payloads or provide world access without an active
authenticated bridge.

### Protocol package

`packages/protocol` owns:

- protocol and message constants;
- command names and mutation classification;
- request schemas;
- stable error codes;
- shared limits and enums;
- envelope validation.

The protocol registry is the source for runtime command discovery. Exhaustive command inventories are
not copied into documentation.

### Foundry module

`packages/foundry-module` runs inside the logged-in Foundry GM client and owns:

- second-boundary request validation;
- GM permission checks;
- protected-metadata sanitization;
- document lookup and serialization;
- capability adaptation across supported Foundry versions;
- mutation preparation and dry-run previews;
- execution through Foundry Document APIs and reviewed typed actions;
- observable write confirmation;
- managed-file containment.

The module ships plain browser-compatible JavaScript. Its generated protocol mirror is produced from
the canonical protocol package.

## Core assumption

An authenticated GM client is open in the target world. The bridge acts through that client's
Foundry runtime and authority. It is not a headless database editor and does not bypass Foundry's
document lifecycle, validation, permissions, hooks, or installed system/module behavior.

## Request flow

```text
CLI invocation
  -> parse flags and validate request schema
  -> connect and authenticate to local daemon
  -> correlate and forward to active bridge
  -> validate, authorize, sanitize, and capability-check
  -> resolve Foundry documents
  -> prepare preview or execute through a Foundry API
  -> serialize observed result or structured error
  -> relay response by request ID
  -> render JSON or human output
```

The bridge advertises its supported commands during the handshake. The daemon forwards only commands
advertised by the active session.

## Validation boundaries

The CLI validation pass provides fast feedback and avoids unnecessary connections. The bridge repeats
validation because the transport input remains untrusted and because Foundry-side capability and
document validation require the live runtime.

Closed protocol schemas define the complete accepted top-level field set for document families owned
by the bridge. Open schemas preserve system/module extensibility but pass through shared sanitization
before validation, diffing, preview, or dispatch.

Foundry DataModels remain the final authority for system-specific and version-specific values.

## Command architecture

Commands are explicit typed handlers rather than a generic RPC. Related document families share
preparation, guard, serialization, and bulk seams so their behavior does not diverge between create,
update, clone, dry-run, and bulk routes.

CRUD handlers operate through document methods. Action handlers call a fixed reviewed Foundry method
and report only the result that can be observed or confirmed. Command-specific behavior is discovered
from the registry and CLI schema surface.

## Mutation model

Mutations are serialized where family behavior requires ordering, but the bridge does not claim a
global transaction. The Foundry UI, systems, modules, and other clients remain concurrent writers.

A dry run performs the same preparation and guards as a real command, then stops before persistence.
Real commands confirm stored state where their contract depends on a write landing. Native Foundry
batch calls can partially apply, so bulk results include per-element outcomes.

Idempotency keys reduce duplicate effects across response loss while the relevant daemon/bridge cache
entry exists. They do not create durable distributed transactions.

## Serialization

Readers serialize authored source state from Foundry document sources. Derived runtime values are
included only through explicit projections and are identified as derived.

List rows are lean discovery projections. Single-document reads expose richer authored projections.
This keeps large collections bounded while allowing callers to inspect a target before mutation.

Result shapes are intentionally narrower than arbitrary Foundry document models. Extensible writes
can therefore accept valid system/module data that a curated read does not echo field-for-field.

## Managed files

File commands use Foundry's public managed-file APIs. Reads address the managed `data` source. Writes
are contained to the active world's allowed asset tree and exclude the world manifest, databases,
and packs.

The bridge receives upload bytes over the local transport; it never resolves an operator-machine
absolute path. File mutations and document-reference mutations remain separate explicit commands.

See [Security](security.md#file-write-boundary) for the full boundary.

## Session lifecycle

The first bridge connection attempt occurs after Foundry is ready. Authentication or protocol
rejection is terminal for that module load so a persistent configuration problem does not create a
reconnect loop. A session that completed the handshake and later loses transport reconnects with
bounded exponential backoff.

The daemon persists multiple pairing profiles but routes through one active bridge. A profile is owned
by one browser: its uniqueness key is Origin, world, GM, and the browser's own persistent client
identifier, which is why the same person can keep two browsers paired to one world and GM and why
re-pairing rotates only the re-pairing browser's credential. Making the browser the unit of ownership
also makes the human label meaningful, so the label travels with the pairing request instead of being
editable daemon-side metadata: it is fixed between pairing approvals, and an approval that reuses an
existing record adopts the label that request carried. The design keeps slot ownership
unambiguous: a socket receives its role only after completed authentication rather
than from a claimed message type; only a same-pairing socket can take over the slot, as the
tab-reload recovery path; intentional goodbye, release, and revocation clear ownership before close
handling, while only an abnormal close creates a short reclaim lease; and daemon-initiated release is
terminal for the released client so reconnection remains an explicit operator action. Every way a
pairing attempt can end shares one idempotent cleanup path, so the authorization UI cannot retain a
stale pending state.

While serving, the daemon owns authentication and connection configuration writes, and preserves a
concurrently changed upload limit until a restart applies it to the transport. Daemon control
operations for pairing, profiles, release, and client credential rotation form the future Companion
boundary and remain separate from the Foundry command registry.

One of those operations parks instead of answering at once: the wait for a pairing request holds its
response until a request arrives or the daemon's own park cap elapses. That cap is what keeps a parked
answer inside the caller's request timeout, so an unanswered wait ends in an empty result the CLI
re-issues rather than in a transport failure; a cap at or above the client's wait would turn every
wait into one.

Normative handshake, takeover, lease, and release semantics are defined in
[Protocol](protocol.md#bridge-sessions); the authentication guarantees and host validation rules are
stated in [Security](security.md#authentication).

### Client-side status signal

The module's own UI needs to react to connection changes rather than read state once, so the bridge
client publishes every status transition instead of assigning the field silently. The Foundry module
re-emits those transitions as the `fvtt-world-cli.statusChanged` hook, which makes the same signal
available to macros and other modules in the GM client. It is a client-side extension point only and
carries no wire-protocol meaning; the daemon and the CLI neither send nor observe it.

The hook fires once per actual change, on the client transport status or on the handshake
acknowledgement, and receives the same snapshot that `system info` reports as `bridge`: `status`,
`url`, `helloAcknowledged`, `hasEstablishedSession`, `lastConnectedAt`, `reconnectAttempts`, and
`terminalStopReason`. Readiness is `status === "connected"` together with `helloAcknowledged`, because
an open socket precedes the daemon's acknowledgement. A snapshot never reports an acknowledged
handshake on a client that is no longer connected: losing the socket resets the acknowledgement before
the status transition that publishes it, so consumers cannot observe that contradictory pair.
`helloAcknowledged` stays in the snapshot for consumers that need the distinction; the module's own
windows fold it into the connection state they display rather than showing it as its own field.

Credential changes are not transitions of this hook. Pairing and unpairing refresh the module's own
windows and toolbar indicator through an internal signal, since the connection state itself has not
changed at that moment.

## Compatibility strategy

The bridge supports the designated Foundry major versions through narrow capability adapters and
explicit guards. It refuses a version-dependent request when it cannot provide the documented result
honestly.

Mocks verify contracts and edge cases but cannot establish real Foundry compatibility. The live smoke
workflow is the authority for executed coverage. Current operator-visible differences are summarized
in [Foundry compatibility](compatibility.md).
