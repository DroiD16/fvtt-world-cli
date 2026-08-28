# Security

fvtt-world-cli is a local administration tool. It gives an authenticated caller access to the
authority of the connected Foundry GM client, within the typed command surface and explicit file
boundary described here.

## Trust boundary

A request travels from the local CLI through the authenticated loopback daemon to the authenticated
Foundry GM bridge, which executes it through Foundry's APIs. The CLI input is untrusted. The daemon
authenticates and routes requests but does not grant Foundry permissions. The bridge validates
requests again and executes them as the connected Foundry user.

The design assumes a trusted local machine and a trusted GM-controlled Foundry session. It is not a
public multi-tenant API.

## Authentication

- The daemon hard-rejects non-loopback listen hosts and validates the exact HTTP Host.
- A random device-local credential authenticates CLI and future Companion clients with a first-message
  `client.hello`; it is stored only in the per-user config file.
- Every first frame and subsequent transport message is checked against a closed protocol schema
  before role assignment or dispatch. Malformed first frames are closed immediately and cannot keep
  an unauthenticated heartbeat connection alive.
- Each browser/world/GM profile has an independent bridge credential. Only its SHA-256 digest is kept
  by the daemon; the clear credential stays in client-scoped Foundry storage.
- A pairing profile is identified by Origin, world, GM, and a per-browser client identifier that the
  browser generates once and keeps in the same client-scoped storage as its credential. The identifier
  is self-asserted and grants nothing: it only scopes which stored record a re-pair replaces, so one
  browser re-pairing cannot rotate another browser's credential out from under it. Access remains
  gated by human approval of the pairing code and by the credential-digest check on every hello, and a
  hello whose client identifier does not match its pairing record is rejected as `UNAUTHORIZED`. That
  storage is shared by every tab of one browser, so a first-use identifier can be generated twice when
  two tabs start pairing at once; the browser discards an approved credential whose identifier no longer
  matches the stored one instead of keeping a pairing the hello gate would refuse.
- The browser label attached to a pairing is constrained by the protocol schema — 1 to 64 characters,
  with whitespace-only values rejected along with control, zero-width, bidirectional-override, and
  Unicode tag characters — and a violating request is refused rather than repaired. Rejecting a
  whitespace-only label removes the simplest way to send a label that reads as nothing; it is not a
  guarantee that a label renders visibly, because blank-rendering filler characters pass the pattern.
  The client identifier printed beside the label is what reliably distinguishes two browsers, including
  two that share one label. The pairing socket is unauthenticated, so any local process can send a
  pairing request, and an unfiltered label would reach a terminal as an escape-sequence injection or as
  hidden text in agent output: both approval prompts, the one `auth approve` shows and the one the
  `auth` pairing wait shows, print it as raw text, and JSON output escapes C0 control characters but
  not C1, zero-width, bidirectional-override, or tag ones. The constraint covers the label field only;
  the identity fields printed beside it are described under Known risks.
- The module removes those same characters from the label it collects in the Authorization window, and
  also normalizes it to NFC, trims it, and caps its length, before the pairing request goes out. That
  sanitizer is a usability layer, not the boundary: it keeps an honest browser from being refused over
  a stray paste, while the schema check in the daemon remains the enforcement point, so a request from
  any other local process is still refused rather than repaired.
- Browser pairing and bridge sockets require a syntactically valid HTTP(S) Origin, matched exactly
  after pairing. Credentials never appear in URLs, command lines, environment variables, or output.
- The bridge starts only for a configured GM client.
- Another pairing cannot displace the active bridge. A same-pairing reconnect may take over after a
  reload; requests already forwarded to the displaced socket fail immediately as indeterminate.
  Abnormal close retains a 30-second lease against other pairings, while intentional goodbye,
  release, and revocation do not create a lease. Release uses a dedicated terminal close code so the
  released browser cannot automatically reclaim the slot.
- Only the exact active authenticated bridge socket can send `bridge.goodbye` or revoke its own
  pairing. A socket is not assigned the bridge role or pairing identity until the complete handshake
  has authenticated.
- Browser Unpair deletes its clear credential only after a correlated successful revocation response.
  On failure it retains the credential for retry; Forget local is a separate action that deliberately
  leaves the daemon-side profile active.
- Protocol-version or authentication rejection stops that bridge load until the Foundry client is
  reloaded. `BRIDGE_BUSY` is reported separately, preserves the credential, and permits manual Retry
  after the current owner is released.
- A bridge that loses live GM authority returns correlated `PERMISSION_DENIED` before it closes and
  does not route the denied command, preserving a determinate no-mutation outcome.

Loopback reduces exposure but does not replace authentication. Other processes running as the same
local user may be able to read local configuration or connect to local ports. The daemon accepts only
the exact normalized Host authority configured for its listener; post-bind publication of a numeric
runtime address does not broaden that authority or invalidate an explicitly configured `localhost`.

## Command boundary

The bridge accepts only explicit commands registered in the protocol and advertised during the
handshake. Each command has a schema and a known handler. There is no generic method invocation or
universal “edit anything” endpoint.

Mutations use Foundry Document APIs or a reviewed typed Foundry action. Raw live world databases are
outside the command surface.

## Validation and protected metadata

Closed document families enumerate writable fields. Open families allow Foundry-, system-, or
module-defined data but pass every write and preview through shared protected-metadata sanitization.

Document identity, statistics, authorship, and raw ownership are server-controlled. Ordinary content
payloads cannot set them. Supported ownership changes use dedicated commands with GM and schema
checks.

Validation occurs in the CLI and again in the bridge. Foundry performs its own DataModel and
permission validation before persistence.

## Permissions and destructive actions

The bridge requires a GM session for mutations. Delete commands can require explicit force where the
document has high-risk references or consequences. A force flag acknowledges the command's defined
guard; it does not bypass Foundry permissions, module hooks, validation, or filesystem containment.

Foundry hooks can veto or partially apply writes. Mutation handlers confirm observable stored state
where the command contract requires it and return structured partial or failed outcomes instead of
claiming success.

Every command also carries a permission in the GM client holding the bridge: allow, approve, or
deny. The permission is resolved and enforced in the Foundry module, after authentication and the
GM and write-permission checks and before the command is dispatched, so it governs reads, writes,
bulk envelopes, and previews alike. The defaults send the destructive commands — every `delete` and
`delete-many` verb, plus `file.delete`, `file.move`, and `scene.fog.reset` — to approval and allow
the rest, which means an installation that updates into this behavior asks the GM before deletions
it used to perform silently.

`system.ping`, `system.info`, and the commands the approval wait itself uses are exempt and stay
allowed whatever the stored permissions say. The exemption exists so that a permission set cannot
lock the bridge out of reporting its own state or out of resolving a decision the GM has already
taken; none of the exempt commands changes world content. They are outside the stored permissions
entirely — an override naming one is dropped when the permissions are read — and the Command
permissions window does not show them, because there is nothing about them to change. Pairing and the other `auth` operations
are answered by the daemon and never reach the module, so no command permission applies to them.

A denied command is also absent from what the CLI's `commands` listing reports while the bridge is
reachable. That is context hygiene for an agent, not a security boundary: the static registry,
`schema`, and this documentation still name the command, and the boundary is the module's refusal at
dispatch. A caller that finds a denied command elsewhere and sends it is answered with
`COMMAND_DENIED` and nothing runs.

A command the policy sends to approval is not run by the request that carried it. The module holds it,
in memory only, until the GM decides, and an allowed command then travels the same guarded path a
direct call takes: Foundry readiness, current-GM authority, parameter validation, the write-permission
check, and the family's own guards are all evaluated again at that moment, and so is the stored
permission of the command itself: a command set to deny while its decision waited is refused with
`COMMAND_DENIED` even after an allow, because deny is a standing refusal rather than a verdict on one
invocation. What the GM's allow settles is the approval the command was waiting on, so a permission
moved between allow and approve while the decision waits does not send it back to the queue. Nothing runs
unless the request first leaves the waiting state, so a denial, an expiry, or a cancellation the
module confirmed means the command never ran. The correlating `approvalId` is a 128-bit random token
revealed only in the answer to the original request, and a caller without it can neither read the
outcome nor cancel the decision.

The decision is taken in the GM-only Command Approval window, which shows one waiting request at a
time: the command name, the remaining time, the names of the documents or managed paths it would
change, and its parameters. It opens by itself when a request arrives, and again when the queue
moves on to another waiting request, so a request that reaches the front of the queue while the
window is closed is still shown rather than expiring unseen. Binary upload content is summarized as
its size rather than printed, so a large payload cannot bury the fields that describe what the
command does. The window names no requester, because the command envelope carries no client
identity: what the GM approves is the invocation in front of them, not a particular caller.

## Document ownership

Ownership is access policy rather than ordinary document content. Raw `ownership` is excluded from
normal create and update payloads. Dedicated `<family>.ownership.set` commands change the default or
per-user level on supported families.

Read projections expose ownership only where the public command contract intentionally includes it.
Embedded documents often derive access from a parent and do not provide an independent ownership
surface. What each family exposes is described by its own schema and result, not by another
family's behavior.

## Executable content

CLI-supplied data cannot create an arbitrary JavaScript execution path through the bridge.

- Macro bodies and chat content can be stored but are not executed or routed through command
  processors.
- Action commands invoke only their fixed typed Foundry methods.
- Writes that supply core script- or macro-executing RegionBehavior types are rejected through a
  shared guard.

Installed systems and modules remain trusted Foundry code. They can register behavior types, hooks,
ActiveEffect interpretations, or other data-driven features whose effects the bridge cannot classify
universally. Operators must review system/module semantics when authoring content those extensions
interpret.

A typed Foundry action can also trigger existing GM-authored automation. Combat changes, table draws,
card actions, document hooks, region triggers, and game-system workflows can cause secondary writes
or chat output after the direct command.

## Settings

Setting discovery is read-only. Listing returns registration metadata, while reading a value requires
an explicit namespace and key. Values are serialized with bounded depth, node count, and byte size.

The CLI does not expose setting writes because settings can alter global security and runtime
behavior and frequently invoke module callbacks.

The command policy lives in two of this module's own client-scoped settings, `commandPolicy` and
`approvalTimeoutMinutes`. Neither value is redacted: `setting.list` shows their registration and
`setting.get` returns their value. They hold no secrets, and a caller that can see which commands
are denied has less reason to keep attempting them. Because no setting-write command exists, the
policy is beyond the CLI's reach by construction: only a human editing it in Foundry can change it.
That edit happens in the GM-only Command permissions window, reachable from Configure Settings →
Module Settings, which is the only writer of the policy itself. The approval timeout is also a plain
number field in the same Module Settings form. Every read resolves that setting against the
protocol's bounds, and a value outside them falls back to the default, so an edit there cannot put
an approval wait outside the supported range.
Client scope means the policy belongs to the browser profile that holds the bridge, so another
browser, profile, or machine applies its own policy rather than the one configured here.

## Search

`world.search` indexes selected authored world and optional compendium content in the connected GM
client. Search results can reveal content visible to that GM, including text not visible to ordinary
players.

Queries and responses are bounded. Search indexes are runtime caches and can be stale until their
invalidation or rebuild completes. Search is a discovery surface, not an authorization boundary.

## File write boundary

File commands operate only through Foundry's managed `data` source.

Reads address normalized managed-data paths. Writes are restricted to the active world's
`worlds/<worldId>/` tree and exclude:

- `world.json`;
- `data/` and all descendants;
- `packs/` and all descendants.

Containment and exclusions are segment-aware and are checked before payload decoding or capability
dispatch. Absolute host paths, traversal, sibling-prefix tricks, and encoded attempts to cross the
boundary are rejected.

The module accepts upload content over the authenticated local transport and a managed data-relative
destination. It does not read arbitrary files from the operator machine. The CLI may read an explicit
local source file supplied by the operator, then sends its bytes as data.

File mutation does not rewrite document references. Reference changes require an explicit document
command so their intent and permissions remain visible.

## Compendium imports

Compendium commands are read-only with respect to packs. Supported import commands create a new world
document from a pack entry using a closed, family-compatible override schema.

Imports preserve legitimate authored source data after normalization. Installed system or module
content can still carry data-driven behavior; importing is not a security audit of the source pack.
The bridge does not expose arbitrary compendium writes.

## Availability and resource limits

The daemon and module bound uploads, WebSocket frames, search work, batch sizes, and selected result
shapes. Oversized operations return structured errors where possible without dropping the shared
bridge session.

Decisions waiting for the GM are bounded the same way: the module weighs each request frame as it
arrives and refuses admission, before anything is displayed or executed, once the waiting decisions
reach either their count or their combined weight. A retained outcome no client has read is never
dropped to make room for a new request.

The system remains susceptible to ordinary local denial of service by an authorized caller issuing
many expensive Foundry operations. It is designed for cooperative local automation, not hostile
multi-user scheduling.

## Known risks

- A stolen device credential lets a local process use the active bridge; a stolen bridge credential
  lets a matching Origin/world/user runtime authenticate that pairing.
- Another OS user able to reach loopback can submit a pairing request with a forged Origin, client
  identifier, and label. Approval therefore trusts that the displayed pending request came from the
  operator's own browser.
- The label and the client identifier are the only pairing identity fields constrained against terminal
  escape sequences. World title and GM name arrive on the same unauthenticated pairing request without
  that constraint, and the CLI prints them as raw text wherever it renders a pending request or a
  stored profile — both approval prompts and the `auth prune` candidate listing, which precedes an
  irreversible deletion. A local process can therefore redraw the identity lines an operator reads
  before answering, and a title that survived one approval is re-rendered from the stored record every
  time a later command lists it.
- `auth approve` with no code refuses while several requests are pending, and the `auth` pairing wait
  instead renders the earliest one and asks about it. A request a local process forged before the
  operator clicked Pair in the browser is therefore the one the wait offers, which is a reason to read
  the rendered identity rather than answer the prompt by reflex. Both commands approve only the request
  whose identity they displayed.
- A compromised GM browser session or installed Foundry module is already inside the trusted runtime.
- Foundry, systems, and modules can attach hooks and side effects to otherwise ordinary writes.
- Timeouts and disconnects can leave delivery indeterminate; a mutation may have committed.
- Native Foundry batch operations are not transactional and can partially apply.
- Search and read commands can expose GM-visible world content to the local caller.
- Large but permitted content can consume browser memory and processing time.
- An approved command executes at the decision rather than at the request, so the world may have
  changed while the decision waited. An approval is a decision about that request, not a lock on the
  state it was read against.
- Decisions waiting for a GM live only in that browser session. Reloading the GM client, or ending
  its bridge session, discards them, and the callers waiting on them are answered indeterminately.
- A caller that disappears without a confirmed cancellation leaves its request actionable on the
  GM's screen until the GM decides or the timeout expires. The command envelope carries no client
  identity, so the module cannot tell that the caller is gone.
- The daemon holds indeterminate idempotency keys — reservations for forwarded keyed requests,
  approval links, and lost-in-flight tombstones — in one bounded store of 1,000 entries shared by
  every client of that daemon. The store refuses new keyed requests with `IDEMPOTENCY_STORE_FULL`
  rather than evicting an older key, because evicting one would make a possibly executed command
  forwardable again. The size is fixed rather than operator-configurable, and exhaustion ends when
  earlier keys settle, when their windows expire, or on a daemon restart or world or pairing switch.
- Command permissions belong to a browser profile. A second paired browser, or the same browser with
  a fresh profile, holds its own permissions, and whichever client holds the bridge is the one whose
  permissions apply.
- Declarative content can reference existing executable or module-interpreted content.

## Operator guidance

- Keep the daemon on loopback, protect the per-user config, and review Origin/world/GM before approval.
- Confirm the connected world and GM identity before mutation.
- Use JSON output, dry runs, stable idempotency keys, and post-write reads for automation.
- Review every outcome of a bulk operation.
- Treat forwarded timeouts and disconnects as potentially committed.
- Set the approval timeout to the time a GM realistically needs to answer. A long timeout keeps a
  request actionable long after its caller gave up; a short one refuses work the GM would have
  approved. Either way the expiry never executes the command.
- Configure command permissions in every browser profile that holds the bridge, and review them
  after an update that adds commands.
- Review installed systems and modules before authoring automation-sensitive data.
- Back up important worlds before large migrations.
- Run the live smoke workflow only in a designated test world.
