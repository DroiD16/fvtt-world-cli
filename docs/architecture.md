# Architecture

The `fvtt-world-cli` monorepo contains a CLI, a local daemon, a shared protocol, and a Foundry
module. Keeping them together lets their contracts change in one release.

## Runtime roles

| Component | Owns |
|---|---|
| `packages/cli` | Command parsing, local configuration and validation, transport, discovery, and output |
| Daemon, within `packages/cli` | Loopback listener, authentication, pairings, the active bridge, request routing, timeouts, and idempotency coordination |
| `packages/protocol` | Command registry, request and transport schemas, mutation classification, error codes, and shared constants |
| `packages/foundry-module` | GM checks, command permissions and approval, document validation, capability adapters, execution, serialization, and write confirmation |

The daemon routes requests without interpreting Foundry document payloads. The module ships
browser-compatible JavaScript with a generated mirror of the protocol package.

## Core assumption

An authenticated GM client is open in the target world. The bridge acts through that client's
runtime and authority, using Foundry's document lifecycle, permissions, validation, and hooks.
Installed systems and modules remain part of the execution environment.

## Request flow

```text
CLI invocation
  -> parse flags and validate request schema
  -> authenticate to local daemon
  -> forward to the active bridge
  -> validate, authorize, sanitize, and capability-check
  -> prepare preview or execute through a Foundry API
  -> confirm and serialize the result, or return a structured error
  -> relay by request ID and render output
```

The bridge advertises its commands during the handshake. The daemon forwards only advertised
commands. A command that requires GM approval waits before execution and passes through the
guards again after approval. The protocol registry supplies every command's default permission.

## Validation and command design

CLI validation gives early feedback. The bridge repeats it because transport input is untrusted
and only the live runtime can check Foundry capabilities and document state.

Closed schemas enumerate writable fields. Open schemas allow system and module data but use
shared sanitization before validation, preview, or execution. Foundry DataModels validate the
system-specific and version-specific values.

Each command has an explicit schema and handler. Document handlers call Foundry document methods;
action handlers call a fixed, reviewed Foundry method. Related operations reuse preparation,
guards, serialization, and bulk helpers so a preview or bulk write cannot bypass a single
command's restrictions.

## Mutation model

A dry run performs the same preparation and guards as a real command, then stops before
persistence. It reserves no state. The Foundry UI, systems, modules, and other clients remain
concurrent writers, and bulk calls are not transactions.

Write handlers confirm stored state before reporting success, since Foundry can veto or modify a
request without throwing. A valid no-op succeeds; a partial or unprovable write returns an error.
[Write confirmation](protocol.md#write-confirmation) defines how the original request is preserved
and compared with the result.

## Serialization

Reads return authored state from Foundry document sources. Derived runtime values require explicit
projections and are identified as derived. Lists use smaller projections than single-document
reads to keep collection responses bounded.

Results expose selected fields, so an extensible write may accept system or module data that a
read does not echo field-for-field.

## Session lifecycle

The daemon routes commands through one active GM browser, which determines their world and
permissions. Pairing and connection management use separate daemon controls so they remain
available without that browser.

The browser owns command approvals; the daemon owns request routing and idempotency coordination.
Both keep temporary state. [Protocol](protocol.md#bridge-sessions) defines ownership, reconnects,
and failure handling, plus the module's [local status hook](protocol.md#client-side-status-signal).

## Compatibility strategy

Narrow adapters handle differences between supported Foundry versions. Unsupported operations
return `UNSUPPORTED_OPERATION`. The CLI, daemon, and module must share the same release version.

Mocks check contracts and edge cases. Only the [live smoke workflow](../scripts/live-smoke.mjs)
establishes which operations were exercised against Foundry. See
[Foundry compatibility](compatibility.md) for differences users need to act on.
