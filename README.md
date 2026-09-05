# World CLI for Foundry VTT

[![Supported Foundry versions](https://img.shields.io/endpoint?url=https%3A%2F%2Ffoundryshields.com%2Fversion%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2FDroiD16%2Ffvtt-world-cli%2Fmain%2Fpackages%2Ffoundry-module%2Fmodule.json)](https://foundryvtt.com)
[![npm](https://img.shields.io/npm/v/fvtt-world-cli)](https://www.npmjs.com/package/fvtt-world-cli)
[![npm downloads](https://img.shields.io/npm/dm/fvtt-world-cli)](https://www.npmjs.com/package/fvtt-world-cli)
[![license](https://img.shields.io/github/license/DroiD16/fvtt-world-cli)](LICENSE)

Tell your AI agent what should change in your Foundry VTT world, and it happens in the live
world, validated by Foundry, visible to your players immediately.

![An AI agent adds lights and goblins to a Foundry tavern scene, shown before and after](https://raw.githubusercontent.com/DroiD16/fvtt-world-cli/main/publishing/media/cover.webp)

Modern agents already understand requests like that. What they have lacked is a safe way into
Foundry. Driving the browser UI is brittle and uses extra tokens. Editing world files on disk
bypasses Foundry's validation.

World CLI for Foundry VTT connects your agent to your open GM session. Every change runs through
Foundry's own APIs, exactly as if a GM had made it in the UI.

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

See [Commands](docs/commands.md) for the full list of supported operations.

## Setting up

The simplest setup is one step: point your AI agent at this repository and ask it to set up
World CLI for Foundry VTT. Then follow its lead. It will most likely ask you to install the module in
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

   Keep this terminal open and use a second terminal for the remaining commands. Keep the target
   world open in Foundry, logged in as a GM.

4. Pair the browser: choose *Pair* in the module's Authorization window, reachable from the
   *World CLI* group in the scene controls or from the module's settings. Then approve the request
   from the terminal. It shows the requesting origin, world, GM, and browser, and asks for a yes
   or no:

   ```bash
   fvtt-world-cli auth
   ```

5. Check the connection in Foundry. The *World CLI* icon in the scene controls turns green when
   connected. Open *Bridge status* from the same group to see the connection details.

6. Optionally, install the packaged skill into your AI agent; the next section explains what it
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

An installed skill stays current on its own: after a package update, the bridge daemon refreshes
it at startup. A copy you have edited locally is never replaced automatically, so your own
instructions survive updates.

## Built to be trusted with a live world

You control which browser connects and which commands the agent may run. The main safeguards are:

- The daemon accepts connections only from your machine, with no internet-facing mode.
- Nothing connects without your approval: every browser pairs once through an explicit yes at your
  terminal, and no secrets are printed along the way.
- Foundry remains the authority: every change runs through the same Document APIs and validation
  the UI uses, under the GM's permissions.
- Any change can be previewed before it happens: a global `--dry-run` flag runs the same
  validation and guards as a real call and stops before mutation.
- Every command has a permission in the active Foundry client: run, ask the GM, or refuse.
  Destructive commands ask the GM by default.
- Commands are typed and validated on both sides of the connection. Macro execution and regions
  that trigger macros are disabled by default and require the GM to enable dedicated commands.
  Region behaviors that execute script code are blocked on every write route.
- File commands read assets within Foundry's managed `data` source. Writes are limited to the
  active world's asset folders and always exclude its manifest, databases, and packs.

[Security](docs/security.md) explains these safeguards and their limits.

## Foundry compatibility

Supported and verified on Foundry VTT v13 and v14. Some commands are available only on certain
Foundry versions. See [Compatibility](docs/compatibility.md) for the differences.

## Documentation

The [documentation index](docs/README.md) links to the command reference, setup guides, security,
compatibility, and technical documentation. These documents also ship with the CLI. Read them
offline with `fvtt-world-cli docs [document]`.

Bug reports and questions go to [GitHub Issues](https://github.com/DroiD16/fvtt-world-cli/issues).
