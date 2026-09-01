# Agent skill

fvtt-world-cli ships with `foundry-world-editor`, an installable Agent Skill, a short operating
manual that teaches an AI agent to drive this CLI safely: how to bring the stack up and check its
health, the read → preview → commit → verify loop, how to classify failures before retrying, and
where the hard safety boundaries are. Skills follow the open Agent Skills standard, so the same
file works in Claude Code, Codex, and every other agent that reads `SKILL.md` files.

The skill deliberately contains no command inventory. Agents discover the exact command surface
from the CLI itself (`commands --json`, `schema <command>`), so the skill stays valid as commands
evolve; it carries only the knowledge that runtime discovery cannot provide. The skill itself lives
at [`skills/foundry-world-editor/SKILL.md`](../skills/foundry-world-editor/SKILL.md).

## Installing

```bash
fvtt-world-cli skill install
```

The default installation delegates to the ecosystem's skills CLI (`npx skills add`), which detects
the agents present on the machine. It keeps one canonical copy under `~/.agents/skills`, the
vendor-neutral location of the Agent Skills standard, and points each agent's own skill directory
at it, so every agent reads the same single copy.

An explicit destination works without the skills CLI or network access:

```bash
fvtt-world-cli skill install --to <skills-directory>
```

`--to` performs a direct copy and records the location in the CLI's local configuration, so that
copy participates in updates later. `--link` symlinks instead of copying, which keeps the installed
skill permanently identical to the CLI it came from.

A bridge daemon started while no copy is installed anywhere prints a reminder with the
installation command, so a missing skill does not go unnoticed.

## Staying up to date

The skill is versioned together with the CLI, and the CLI keeps installed copies current on its
own: the bridge daemon checks every known copy at startup and refreshes outdated ones, so a package
update takes effect the next time the daemon starts. The check runs inside the CLI itself; nothing
about installation or updates relies on npm lifecycle scripts, which npm blocks by default. For
updates, a copy is one of two kinds:

- An **unmodified** copy, exactly what some version of the CLI shipped, is replaced silently with
  the current version.
- A **modified** copy, one with local edits, is never replaced automatically. It produces a
  warning instead, and keeps producing it until the difference is resolved.

The explicit update command follows the same rule and can override it:

```bash
fvtt-world-cli skill update
fvtt-world-cli skill update --force
```

The CLI tells an old shipped version apart from a local edit by a content checksum recorded inside
every installed copy, so an outdated installation is never mistaken for a customized one.

## Removing

```bash
fvtt-world-cli skill remove
fvtt-world-cli skill remove --to <skills-directory>
```

The default removal uninstalls the canonical copy, the agent links pointing at it, and every
location recorded for `--to` installations; `--to` removes one location and forgets it.
