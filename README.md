# World CLI for Foundry VTT

[![Foundry VTT v13–v14](https://img.shields.io/badge/Foundry%20VTT-v13%E2%80%93v14-ff6400)](https://foundryvtt.com)

Tell your AI agent what should change in your Foundry VTT world, and it happens in the live
world, validated by Foundry, visible to your players immediately.

```text
You → agent:  "The scimitar in Valeros's inventory should burn targets on hit.
               Add a Flaming effect to it."

agent → fvtt-world-cli:
              actor list --name Valeros            find the character
              actor item list --name scimitar      find the sword in their inventory
              actor item effect create …           add the effect to it

agent → you:  "Done. Flaming effect added, already live in the world."
```

Modern agents already understand requests like that. What they have lacked is a safe way into
Foundry: driving the browser UI is brittle and token consuming, and editing world files on disk
bypasses everything Foundry does to keep a world consistent. fvtt-world-cli is the missing bridge,
a command line wired into your open GM session that performs every change through Foundry's own
APIs, exactly as if a GM had made it in the UI.

Two things it's not. It is not an AI game master: it does not run the game, it only edits the
world when asked. And it includes no AI of its own: you connect the agent you already use, such as
Codex, Claude Code, or Hermes.

## What your agent can do

The everyday GM work: build and edit characters and their inventories, write journals, manage
scenes down to individual tokens, walls, and lights, and pull content in from compendiums.

A few asks it handles end to end:

- "Sort the journals into folders by location."
- "Dim every light in the tavern scene down to torchlight."
- "Find every NPC that still has no portrait and list them."
- "Turn the bestiary goblin into a flying one that throws dynamite for 2d6 damage, and add it to
  the scene."

[Commands](docs/commands.md) maps the full surface.

## Setting up

The simplest setup is one step: point your AI agent at this repository and ask it to set
fvtt-world-cli up. Then follow its lead. It will most likely ask you to install the module in
Foundry and click *Pair* there, and it handles the rest itself.

### Manual setup

Two pieces install separately and pair on first run: the CLI on your machine and a bridge module in
Foundry. The CLI connects to the module in your open GM session, and through that connection the
agent works with the world.

1. Install the CLI (Node.js 20+):

   ```bash
   npm install -g fvtt-world-cli
   ```

2. Install the module (Foundry VTT v13–v14): paste the manifest URL into Foundry's
   *Install Module* dialog, then enable the module in the target world:

   ```
   https://github.com/DroiD16/fvtt-world-cli/releases/latest/download/module.json
   ```

3. Start the daemon and leave it running:

   ```bash
   fvtt-world-cli bridge serve
   ```

4. Pair the browser: choose *Pair* in the module's Authorization window, reachable from the
   *World CLI* group in the scene controls or from the module's settings. Then approve the request
   from the terminal. It shows the requesting origin, world, GM, and browser, and asks for a yes
   or no:

   ```bash
   fvtt-world-cli auth
   ```

5. Optionally, install the packaged skill into your AI agent; the next section explains what it
   does:

   ```bash
   fvtt-world-cli skill install
   ```

Pairing happens once per browser; afterwards the bridge reconnects on its own whenever the daemon
and a paired GM client are both up. [Getting started](docs/getting-started.md) walks through the
first run in detail. The canonical executable is `fvtt-world-cli`; `worldctl` is an equivalent
short alias.

## Handing it to your agent

The package ships `foundry-world-editor`, an installable [Agent Skill](docs/skill.md) that teaches
an agent to drive the CLI safely. It follows the open Agent Skills standard, so the same skill
works in Claude Code, Codex, and other agents that read `SKILL.md` files.

An installed skill stays current on its own: updating the package refreshes it. A copy you have
edited locally is never replaced automatically, so your own instructions survive updates.

## Built to be trusted with a live world

The whole design assumes an automated caller that must not be able to exceed its intended
authority; [Security](docs/security.md) covers the boundaries in full. In short:

- Everything stays on your machine: the daemon accepts loopback connections only, and there is no
  internet-facing mode.
- Nothing connects without your approval: every browser pairs once through an explicit yes at your
  terminal, and no secrets are printed along the way.
- Foundry remains the authority: every change runs through the same Document APIs and validation
  the UI uses, under the GM's permissions.
- Any change can be previewed before it happens: a global `--dry-run` flag runs the same
  validation and guards as a real call and stops before mutation.
- Every command has a permission in the active Foundry client: run, ask the GM, or refuse.
  Destructive commands ask the GM by default.
- There is no arbitrary-code path: commands are typed and validated on both sides of the transport,
  and executable content such as scripted region behaviors is blocked on every write route.
- File access is confined to the active world's managed assets and always excludes its manifest,
  databases, and packs.

## Foundry compatibility

Supported on Foundry VTT v13 and v14 (both verified). Version-dependent behavior is
capability-gated and reported per command; [Compatibility](docs/compatibility.md) lists the
differences that matter to operators.

## Documentation

[docs/README.md](docs/README.md) maps the full set: commands, protocol, security, architecture,
compatibility, and the agent skill. The same documents ship inside the package and are printed by
`fvtt-world-cli docs [document]`, so the installed CLI is self-describing offline.

Bug reports and questions go to [GitHub Issues](https://github.com/DroiD16/fvtt-world-cli/issues).
