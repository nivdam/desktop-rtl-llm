# Running

## Purpose

This file explains exactly how an agent should run the local RTL setup on this machine.

Use this file first if you need to launch, reinstall, or debug Claude RTL or Codex RTL.

## Working Directory

Run commands from the repo root:

```bash
cd /Users/nivdamianovich/BizoDam/desktop-rtl-llm
```

## Claude

### Known limits

`Claude RTL.app` is a patched local copy signed ad-hoc. Use it for Hebrew chat UI.

Do not use it as the source of truth for:

- app updates
- Cowork/Workspace features that require macOS virtualization entitlements

For those, use the original `/Applications/Claude.app`. After updating the original app, rebuild the RTL copy:

```bash
./run-rtl.sh claude
```

### Hebrew mode

Launch Claude RTL through the sync-aware launcher:

```bash
./run-rtl.sh claude
```

This checks whether `/Applications/Claude.app` changed. If needed, it rebuilds `Claude RTL.app` before opening it.

### Install Claude RTL

If the app does not exist yet:

```bash
./run-rtl.sh claude --install
./run-rtl.sh claude
```

### Reinstall Claude RTL after changes

If `runtime/rtl.css`, `runtime/rtl-runtime.js`, `inject-runtime.mjs`, or Claude profile logic changed:

```bash
pkill -f "Claude RTL.app"
./run-rtl.sh claude --reinstall
open "$HOME/Applications/Claude RTL.app"
```

### Check Claude install status

```bash
./run-rtl.sh claude --status
```

### Remove Claude RTL

```bash
./run-rtl.sh claude --uninstall
```

## Codex

### Hebrew mode from Terminal

```bash
./run-rtl.sh codex
```

This launches or attaches to Codex and injects the RTL runtime.

### Diagnostics

```bash
./run-rtl.sh codex --diagnostics
```

Use this when Hebrew rendering looks wrong and you need proof about:

- target selection
- style injection
- runtime injection
- computed message styles

### DOM dump

```bash
./run-rtl.sh codex --dump-html --diagnostics
```

Outputs are written under:

```text
state/codex-dom-dump.html
state/codex-dom-dump.json
```

## Local App Paths

Relevant app paths on this machine:

```text
/Applications/Claude.app
/Applications/Codex.app
~/Applications/Claude RTL.app
```

## When To Reinstall

### Claude requires reinstall

Reinstall Claude RTL after changing:

- `runtime/rtl.css`
- `runtime/rtl-runtime.js`
- `inject-runtime.mjs`
- `claude-installer.mjs`
- `profiles/claude.json`

### Codex usually does not require reinstall

For Codex, rerunning:

```bash
./run-rtl.sh codex
```

is normally enough after:

- CSS changes
- runtime logic changes
- Codex profile changes

## First Debug Path

If the issue is in Claude:

1. Verify whether the problem is reproducible in `Claude RTL.app`.
2. Check local override values in `profiles/claude.local.json`.
3. Reinstall Claude RTL after changing runtime behavior.

If the issue is in Codex:

1. Run `./run-rtl.sh codex --diagnostics`.
2. If needed, run `./run-rtl.sh codex --dump-html --diagnostics`.
3. Check local override values in `profiles/codex.local.json`.

## Rule For Future Agents

Do not guess how to launch the project.

Use the commands in this file first.
