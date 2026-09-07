# Security

`fvtt-world-cli` is a local administration tool. An authenticated caller acts with the connected
GM client's authority, limited by the commands, permissions, and file rules described here.

## Trust boundary

Requests travel through the authenticated loopback daemon to a Foundry GM browser. The daemon
routes requests; the bridge validates them and executes through Foundry's APIs as the connected GM.

The design assumes a trusted local machine and GM session. Processes running as the same OS user
may be able to read the CLI credential. A compromised GM browser or installed module is already
inside the trusted runtime.

Reads and search can expose any content the connected GM can see, including material hidden from
players.

## Authentication

- The daemon refuses non-loopback listen hosts and validates the exact configured HTTP Host.
  Loopback does not replace authentication.
- Local clients authenticate with a random credential stored in the per-user configuration.
  The daemon validates the first frame before assigning a socket's role.
- Each Origin/world/GM/browser pairing has its own bridge credential. The daemon stores only its
  SHA-256 digest; the clear credential stays in client-scoped Foundry storage. Credentials do not
  appear in URLs, command lines, or output.
- Browser sockets require a valid HTTP(S) Origin that matches the paired Origin exactly. The
  hello must also match the stored browser client id.
- The bridge requires GM authority. Losing that authority causes command rejection before
  dispatch and ends the connection.
- Another pairing cannot displace the active bridge. Only the authenticated active socket may
  release ownership or revoke its own pairing.

Unpair deletes the browser's credential only after the daemon confirms revocation. *Forget local*
removes that local credential without revoking the daemon record. Local commands can revoke a
pairing or rotate the CLI credential; see [Authorization commands](commands.md#authorization-commands).

## Command boundary

The bridge accepts explicit, schema-validated commands advertised during the handshake. Document
mutations use Foundry Document APIs; action commands call fixed, reviewed methods. There is no
generic RPC, arbitrary JavaScript evaluation, or direct access to live world databases.
Compendium commands cannot edit packs; imports create world documents.

### Validation and protected metadata

Closed document schemas enumerate writable fields. Open schemas allow system and module data but
sanitize protected metadata on every write and preview. Identity, statistics, authorship, and raw
ownership cannot be set through ordinary content payloads. Foundry also applies its own DataModel
and permission checks.

### Document ownership

Dedicated `<family>.ownership.set` commands change supported default or per-user access levels.
Embedded documents often inherit access from their parent.

## Permissions and destructive actions

The GM browser assigns commands one of three modes: allow, approve, or deny. Its policy covers
reads, writes, bulk commands, and dry runs. Permissions belong to that browser profile; a second
paired browser can have a different policy.

By default, code execution, setting writes, and user role or permission changes are denied.
Destructive operations, GM-client reload, and user creation require approval. The Command permissions
window shows the full current policy. State checks and internal approval controls remain available;
daemon-side `auth` commands are outside this policy.

The module enforces command permissions at dispatch. An approved request passes the normal guards
again and cannot run if its command was changed to deny while waiting. A force flag acknowledges
a command's specific guard but does not bypass permissions, hooks, validation, or file containment.

Denial, expiry, or confirmed cancellation prevents execution. Approval does not lock world state,
and the browser stores decisions only in memory. A disconnected caller's request can remain
actionable until a decision or expiry. Choose an approval timeout that gives the GM enough time
without leaving forgotten requests open. See [Approval flow](protocol.md#approval-flow) for
cancellation and lost-state handling.

### What the approval window shows

The GM-only window shows the command, targets, parameters, and remaining time. Binary uploads
appear by size. Text over 16,384 characters, including macro bodies, is replaced by its character
count. For `macro.execute`, inspect longer bodies in Foundry's macro editor before approving.
Proposed `macro.create` or `macro.update` content may not exist there yet; inspect it separately
or decline if the window does not show enough to review.

The request carries no caller identity. The GM approves the displayed invocation, but the window
cannot identify the local person or process that requested it.
Reading or cancelling a decision requires its opaque approval identifier.

## Executable content

Code execution requires the GM to enable dedicated commands. Ordinary document writes store macro
bodies without executing them and reject core executable region behavior types.

### World macros

`macro.execute` runs a stored world macro and is denied by default. Approve mode lets the GM review
each invocation within the window's [text display limit](#what-the-approval-window-shows).

The module captures the macro body and type when approval is requested. The window shows that
capture, and execution checks it against the stored macro immediately before dispatch. An edit,
deletion, or missing capture returns `APPROVAL_STALE` without running the macro. Read the current
macro before requesting fresh approval; follow the [retry rules](protocol.md#delivery-states-and-retries).

Enabling execution also permits a caller to create a macro, execute it, then delete it. To restrict
execution to vetted macros, set `macro.create` and `macro.update` to approve or deny as well.

A macro timeout does not stop the macro. A thrown error does not undo earlier changes, and a
macro that catches its errors may return normally. Verify effects before retrying.

### Executable region behaviors

Ordinary behavior writes, including behaviors nested inside a region, reject core executable
types. The separate `scene.region.behavior.executable` commands are denied by default and accept
only `executeMacro` with an existing world macro. The approval window shows the macro reference,
events, and whether it runs for everyone. Payload guards reject ambiguous representations of
those fields so validation and review refer to the same values.

These behaviors run on future region events. With `everyone: true`, the macro runs on every
connected client. Approval authorizes that reference and its future triggers, with no new decision
for each event. It does not freeze the macro body.

`executeScript` is unsupported on every route because Foundry executes it in player browsers
without a per-user execution check.

### Existing Foundry automation

Systems and modules can interpret ActiveEffects, register behavior types, and attach hooks to
ordinary document changes. Typed actions such as combat transitions, table draws, and card deals
can trigger existing automation and secondary writes. The bridge cannot classify or undo every
side effect of trusted Foundry code. This also applies to content imported from compendiums.

## Settings

Setting writes can change security, loaded modules, or runtime behavior and invoke callbacks.
Approval shows the stored and proposed values.

Writes to this module's own namespace are forbidden, including in dry runs and bulk operations.
A command therefore cannot enable itself, change its approval timeout, or overwrite credentials.
A GM changes these settings in Foundry, separately for each browser profile.

Reads redact this module's secret-bearing settings. Non-secret permission settings remain readable.

## Users

- Passwords and password salts cannot be read or written. Change passwords in Foundry's UI.
- Creating a user can grant any role up to the caller's own, including GM. Review the role shown
  in the approval window; set `user.create` to deny if automation should not create accounts.
- The account holding the bridge cannot delete itself or change its own role or permissions.
  Other GM accounts do not have this bridge-specific protection.
- Foundry also prevents raising a role above the caller's and demoting or deleting the last GM.

## File write boundary

File commands use Foundry's managed `data` source. Reads may address managed assets; writes stay
under the active world's `worlds/<worldId>/` tree and exclude `world.json`, `data/**`, and `packs/**`.

Containment checks run before payload decoding and capability dispatch. They examine path segments
and their percent-decoded forms, rejecting traversal, encoded separators, absolute host paths, and
sibling-prefix tricks. Managed local paths used by `image show` follow the same normalization rules.

The CLI may read an explicitly supplied local upload source. It sends bytes and a managed-data
relative destination; the module cannot read arbitrary operator-machine files. File mutations do
not rewrite document references. Reference changes require a separate document command.

`image show` also accepts off-host HTTP(S) URLs. These make the targeted players' browsers fetch
and display the remote image; they are outside the managed-file boundary.

## Availability and resource limits

The daemon and module bound uploads, transport frames, search work, batches, and approval queues.
Oversized requests return structured errors where possible.

These limits do not prevent an authorized caller from exhausting browser resources through many
expensive operations. The tool assumes cooperative local automation.

## Known risks

- A stolen CLI credential permits use of the active bridge. A stolen bridge credential permits
  authentication with the matching pairing identity and Origin.
- A local process can forge a pairing request's Origin, browser id, and label. Bare `auth` offers
  the earliest pending request, which may precede the operator's own request. Check the displayed
  identity before answering; approval applies only to the request shown.
- World titles and GM names arrive in unauthenticated pairing requests without terminal-escape
  restrictions. The CLI prints them as raw text in prompts and profile listings, including
  `auth prune`. A forged value can redraw identity lines, and a stored value can do so again later.
