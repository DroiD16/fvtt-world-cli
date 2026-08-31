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
- The bridge starts only for a configured GM client. The module hides its settings and category from
  users below the Assistant GM role, and only gamemasters can open its windows. The settings remain
  registered in that browser profile for a later GM session.
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

Every command also carries an allow, approve, or deny permission in the GM client holding the
bridge. The Foundry module enforces it after authentication, GM authority, and write-permission
checks but before dispatch. It covers reads, writes, bulk envelopes, and previews. The default
policy denies commands that can execute code, change who can do what, or persist outside the
world's own data; requires approval for destructive commands — the `delete` and `delete-many`
verbs, `file.move`, `scene.fog.reset`, and `chat.flush` — plus `system.reload` and `user.create`;
and allows the other policy-controlled commands. A denied-by-default command is a deliberate
opt-in: it exists so a GM can enable it knowingly, not so it can run out of the box.

`system.ping`, `system.info`, and the internal approval-wait commands always run. They let the bridge
report its state and finish decisions already taken without changing world content. Stored policy
overrides cannot change them, and the permissions window omits them. Pairing and other `auth`
operations run in the daemon, so the command policy does not apply.

A denied command is absent from the CLI's `commands` listing while the bridge is reachable. This
reduces irrelevant choices for automated callers but does not enforce the policy. The Foundry module
enforces it at dispatch and returns `COMMAND_DENIED` if a caller sends the command anyway.

The original request does not execute a command that requires approval. The module holds it in
memory until the GM decides. After Allow, the module repeats readiness, GM authority, parameter,
write-permission, policy, and family checks. A command changed to deny while waiting returns
`COMMAND_DENIED`. Changing it between allow and approve does not create a second approval. A denied,
expired, or confirmed-cancelled request never runs.

The module returns a random 128-bit `approvalId` only to the original caller. Reading or cancelling
the decision requires that identifier.

The GM-only Command Approval window shows the command, remaining time, target documents or managed
paths, and parameters. It reports binary upload content by size instead of rendering the payload,
and any text longer than 16,384 characters — including a macro body — by its character count for the
same reason. A macro long enough to cross that line is therefore approved on its name and origin
rather than on its code, and `macro.create` runs by itself under the shipped defaults, so a GM who
wants every body reviewable moves `macro.create` and `macro.update` to approve as well. The command
envelope has no caller identity, so the window cannot name the requester. The GM approves the
displayed invocation, not a person or process.

## Document ownership

Ownership is access policy rather than ordinary document content. Raw `ownership` is excluded from
normal create and update payloads. Dedicated `<family>.ownership.set` commands change the default or
per-user level on supported families.

Read projections expose ownership only where the public command contract intentionally includes it.
Embedded documents often derive access from a parent and do not provide an independent ownership
surface. What each family exposes is described by its own schema and result, not by another
family's behavior.

## Executable content

The bridge executes no JavaScript that the GM has not explicitly enabled and cannot see before it
runs. There is no `eval`-style command, and CLI-supplied data cannot create a hidden execution path
through ordinary writes.

- `macro.execute` is the one way to run code, and it runs only stored world macros. It is denied by
  default; a GM who enables it can keep it on approve, where the Command Approval window shows the
  macro's type and its command body — up to the length cap described above — before anything runs. The `macro.create → macro.execute →
  macro.delete` chain is the sanctioned path for ad-hoc code, so a GM who wants only vetted macros
  to run sets `macro.create` and `macro.update` to approve or deny while `macro.execute` stays
  enabled. A script macro that throws fails the command with a structured error naming what the
  macro raised, and the failure is partial by nature: whatever the macro changed before it threw
  stays changed. A macro that catches its own errors still reports a `null` return, so results do
  not prove success and effects deserve a read-back.
- Macro bodies and chat content written by ordinary document commands are stored, not executed.
- Action commands invoke only their fixed typed Foundry methods.
- Ordinary region-behavior writes reject core script- or macro-executing types through a shared
  guard, including on nested behaviors supplied with a region write. The dedicated
  `scene.region.behavior.executable` commands, denied by default, accept exactly the `executeMacro`
  type and require the referenced world macro to exist; the approval window names the macro and
  shows whether the behavior fires for everyone. Those commands accept a behavior's `system` only as
  a plain object or as dotted `system.<field>` paths, never as both and never through Foundry's
  forced-replacement or forced-deletion operator keys: Foundry resolves such a key against a plain
  `system` beside it in key-insertion order, so the stored macro reference could differ from the one
  the macro check validated and the approval window showed. An `executeMacro` behavior triggers later on
  player-driven region events, with `everyone: true` running the macro on every connected client.
- `executeScript` behaviors are not supported on any route: Foundry runs their source in every
  connected player's browser with no per-user execution check, which no popup can make reviewable.

Installed systems and modules remain trusted Foundry code. They can register behavior types, hooks,
ActiveEffect interpretations, or other data-driven features whose effects the bridge cannot classify
universally. Operators must review system/module semantics when authoring content those extensions
interpret.

A typed Foundry action can also trigger existing GM-authored automation. Combat changes, table draws,
card actions, document hooks, region triggers, and game-system workflows can cause secondary writes
or chat output after the direct command.

## Settings

Listing returns registration metadata, while reading a value requires an explicit namespace and key,
singly or in a batch. Values are serialized with bounded depth, node count, and byte size, and this
module's own secret-bearing settings are redacted from every read.

`setting.set` and `setting.set-many` exist because module configuration is a legitimate
administration task, and they are denied by default because settings can alter global security and
runtime behavior and frequently invoke module callbacks: a write to `core.permissions` or
`core.moduleConfiguration` changes what the GM client itself can do or load. Writes go through
Foundry's own registration and DataField validation, and only registered settings are writable. The
approval behavior shows the stored value next to the proposed one before a write runs.

The command policy stays beyond the CLI's reach by construction: the write commands refuse this
module's namespace with a structured error in every mode — real, dry-run, and per bulk element —
so no policy setting, credential, or approval timeout can be changed from the surface the policy
governs. The client-scoped `commandPolicy` and `approvalTimeoutMinutes` settings remain readable
because they contain no secrets, and only a GM using Foundry changes them: the Command permissions
window writes the policy, and the main Module Settings form writes the timeout and enforces its
bounds. Another browser profile or machine has its own values.

## Users

User accounts are managed through explicit per-purpose commands rather than one open patch surface.

- No command reads or writes `password` or `passwordSalt`. Foundry transmits a set password in
  clear text and hashes it server-side, so a password path through the bridge would expose secrets
  in transcripts and logs; password changes stay in Foundry's own UI.
- `user.update` edits profile fields — name, color, pronouns, avatar, assigned character, flags —
  and is allowed by default because none of them grant authority.
- `user.create` and `user.delete` ask for approval by default. `user.role.set` and
  `user.permissions.set` are denied by default because they change who can do what.
- A `user.create` carries whatever role it asks for, up to the caller's own, so an approved one can
  mint a gamemaster. That is why it asks for approval rather than running by itself: the approval
  window names the account and the role — including the player role Foundry gives when the command
  asks for none — and the GM reading it is the review point. A GM who does not want that decision
  in the loop at all sets `user.create` to deny.
- The bridge GM's own account is self-protected: `user.role.set` and `user.delete` aimed at the
  user holding the bridge are refused with a structured error, so automation cannot demote or
  remove the account it runs through. A second GM account carries no such guard — deciding about it
  is exactly what enabling the command means.
- Foundry's server-side limits stay in force underneath: a role cannot be raised above the caller's
  own, and the last gamemaster account can be neither demoted nor deleted. Those refusals surface
  as permission errors with Foundry's own message.

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
dispatch. Path normalization rejects a segment whose literal or percent-decoded form is `.` or `..`,
so absolute host paths, traversal, sibling-prefix tricks, and percent-encoded traversal (`%2e%2e`)
cannot cross the boundary; this applies to every managed-path caller, including `image show`.

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

The module limits the number and combined size of approval requests. It refuses an excess request
before display or execution. It does not discard an unread outcome to admit a new request.

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
- An approved command executes when the GM decides, so the world may have changed while it waited.
  Approval does not lock world state.
- Decisions waiting for a GM live only in that browser session. Reloading the GM client or ending
  its bridge session discards them. Waiting callers receive an indeterminate result.
- A caller that disappears without a confirmed cancellation leaves its request actionable on the
  GM's screen until the GM decides or the timeout expires. The command envelope carries no client
  identity, so the module cannot tell that the caller is gone.
- The daemon keeps reservations, approval links, and lost-in-flight idempotency keys in one bounded
  store shared by its clients. It returns `IDEMPOTENCY_STORE_FULL` instead of evicting an
  indeterminate key. Capacity returns when earlier keys settle or expire, or when a daemon restart,
  world switch, or pairing switch clears the store.
- Command permissions belong to a browser profile. A second paired browser, or the same browser with
  a fresh profile, holds its own permissions, and whichever client holds the bridge is the one whose
  permissions apply.
- Declarative content can reference existing executable or module-interpreted content.
- An enabled `macro.execute` or executable-behavior command makes the GM's enablement and approval
  discipline the effective code-review boundary; an enabled `setting.set` can change core settings
  that alter the GM client's own capabilities or take it down until a reload.

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
