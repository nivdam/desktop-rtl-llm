# AGENTS.md

## Purpose

This repo is the source-of-truth project for the local desktop RTL runtime used with desktop LLM apps.

It is not an app product. It is a local tooling/runtime project.

## Main Targets

- Codex Desktop
- Claude Desktop

## Current Strategy

- Codex: runtime injection into the normal app
- Claude: patched local copied app at `~/Applications/Claude RTL.app`

## Rules

- Prefer the smallest app-specific fix that explains the bug.
- Do not assume Claude and Codex share the same DOM behavior.
- Run diagnostics before making broad CSS changes.
- Avoid reintroducing `wrapTextNodes` unless there is a concrete reason.
- Preserve the original app installs.

## Files That Matter Most

- `inject-runtime.mjs`
- `claude-installer.mjs`
- `setup-launchers.mjs`
- `runtime/rtl-runtime.js`
- `runtime/rtl.css`
- `profiles/claude.json`
- `profiles/codex.json`
- `docs/RUNTIME.md`
- `docs/LAUNCHERS.md`
- `docs/PLAN.md`

## Local-Only State

These are intentionally ignored by git:

- `profiles/*.local.json`
- `logs/`
- `state/`

They may still matter for debugging on the current machine.

## Workflow

If the issue is in Codex:

1. Check `profiles/codex.local.json`.
2. Run `./run-rtl.sh codex --diagnostics`.
3. Use `--dump-html` if classification or CSS is unclear.

If the issue is in Claude:

1. Check `profiles/claude.local.json`.
2. Change runtime or CSS carefully.
3. Reinstall with `./run-rtl.sh claude --reinstall`.
4. Open with `./run-rtl.sh claude` or `Claude RTL Launcher.app`.

If Spotlight launchers are missing or stale:

```bash
node setup-launchers.mjs
```

## Handoff

Before changing runtime behavior, read:

- `docs/RUNNING.md`
- `docs/RUNTIME.md`
- `docs/LAUNCHERS.md`
- `docs/PLAN.md`
