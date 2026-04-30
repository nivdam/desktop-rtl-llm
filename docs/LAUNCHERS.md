# Launchers

## Purpose

The Spotlight launchers are local macOS app wrappers that run the repo scripts.

They make daily use simple:

```text
Cmd+Space -> Claude RTL Launcher
Cmd+Space -> Codex RTL Launcher
```

## Local Apps

These apps live outside git:

```text
~/Applications/Claude RTL Launcher.app
~/Applications/Codex RTL Launcher.app
```

They are generated local machine state, like `logs/` and `state/`.

## What They Run

`Claude RTL Launcher.app` runs:

```bash
cd /Users/nivdamianovich/BizoDam/desktop-rtl-llm
./run-rtl.sh claude
```

This syncs `~/Applications/Claude RTL.app` from `/Applications/Claude.app` when needed, then opens it.

`Codex RTL Launcher.app` runs:

```bash
cd /Users/nivdamianovich/BizoDam/desktop-rtl-llm
./run-rtl.sh codex
```

This launches or attaches to Codex and injects the RTL runtime.

## Recreate Launchers

Run:

```bash
cd /Users/nivdamianovich/BizoDam/desktop-rtl-llm
node setup-launchers.mjs
```

The script:

- creates both launcher apps under `~/Applications`
- embeds the current Node path so Spotlight launches work without shell setup
- copies the icons from `/Applications/Claude.app` and `/Applications/Codex.app`
- registers the apps with LaunchServices for Spotlight

## Important

Open `Claude RTL Launcher.app`, not `Claude RTL.app`, for normal use.

`Claude RTL.app` is still required. It is the patched app bundle. The launcher is only the convenient entry point that keeps it synced.
