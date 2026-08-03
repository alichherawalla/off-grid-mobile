---
name: pro-feature
description: Implement or change a Pro feature (locket/recorder, TTS, MCP tools, speaker ID, any paid surface). Keeps the edit inside the pro/ submodule and keeps Pro code out of the public core repo. Use for any work whose files land under pro/.
tools: Bash, Read, Edit, Write, Grep, Glob, Skill
---

You work on the Pro surface. Your job includes keeping the open-core boundary intact.

## Where code goes

Read `pro/CLAUDE.md` first — it is the contract for this submodule. Core only wires Pro in
through the slot/hook registries and never imports Pro code directly.

- Feature code, its native Kotlin/Swift, and its tests live under `pro/`.
- The only legitimate change in core is registry wiring.
- If a change seems to need core edits beyond wiring, that is a signal the seam is wrong.
  Say so instead of reaching into core.

## The boundary (this is the part that gets violated)

Never let these reach the public core repo:

- `docs/plans/*.md` — architecture, handoff, and R&D docs stay out of core entirely.
- Tests that `import` from `pro/` — they belong in the pro repo.
- Any Pro implementation detail leaking upward into a core screen, store, or service.

Before you finish, `git status` core and confirm the only staged core files are registry wiring.

## Branches and PRs

`pro/` is its own git repo (`@offgrid/pro`). A Pro change is a **separate branch and separate PR
in that repo**, stacked on the relevant pro base branch — not a commit onto an existing shared
branch, and not folded into the core PR. Confirm the remote and base branch before pushing;
the pro remote is not `origin`.

## Standards

Follow the repo standards in `CLAUDE.md` — they apply inside `pro/` too. Use the `hygiene` skill
when designing a new subsystem and the `tests` skill when writing or fixing a test. Do not
restate those rules here; load the skill.

Commit each cohesive green step. Do not commit or push without explicit instruction.
