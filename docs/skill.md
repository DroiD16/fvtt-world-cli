# Agent skill

The package includes [foundry-world-editor](../skills/foundry-world-editor/SKILL.md), operating
instructions for AI agents that support Agent Skills.

## Installing

```bash
fvtt-world-cli skill install
```

The default installation runs `npx skills add`, which detects the agents present on the machine.
It keeps a shared copy under `~/.agents/skills` and links the agents' skill directories to it.

An explicit destination works without the skills CLI or network access:

```bash
fvtt-world-cli skill install --to <skills-directory>
```

The CLI records this destination for later updates. Add `--link` to use the packaged skill
directly through a symlink:

```bash
fvtt-world-cli skill install --to <skills-directory> --link
```

`--link` requires `--to`. A linked skill follows CLI package updates automatically.

## Staying up to date

At startup, the daemon updates unmodified copies in the shared directory and recorded `--to`
locations. It preserves locally edited copies and warns instead of overwriting them.

To update manually:

```bash
fvtt-world-cli skill update
```

Add `--force` to replace a locally edited copy with the packaged version.

## Removing

```bash
fvtt-world-cli skill remove
fvtt-world-cli skill remove --to <skills-directory>
```

The default removal uninstalls the canonical copy, the agent links pointing at it, and every
location recorded for `--to` installations; `--to` removes one location and forgets it.

## JSON output

For `skill install`, `skill update`, and `skill remove`, `--json` requires an explicit `--to`
destination:

```bash
fvtt-world-cli skill install --to <skills-directory> --json
```
