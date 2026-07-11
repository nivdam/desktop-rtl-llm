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

### Apply runtime/CSS/profile changes

The Claude bootstrap reads `runtime/rtl.css`, `runtime/rtl-classifier.js`,
`runtime/rtl-runtime.js`, and `profiles/claude*.json` from this repo on every
app launch. After editing them, just restart the app.

`pkill -f "Claude RTL.app"` leaves the main process alive — kill by PID:

```bash
ps -eo pid,command | grep "Claude RTL.app/Contents/MacOS/Claude" | grep -v grep | awk '{print $1}' | xargs kill
open "$HOME/Applications/Claude RTL.app"
```

### Reinstall Claude RTL after installer changes

Only needed when `claude-installer.mjs` (bootstrap logic) changed:

```bash
ps -eo pid,command | grep "Claude RTL.app/Contents/MacOS/Claude" | grep -v grep | awk '{print $1}' | xargs kill
./run-rtl.sh claude --reinstall
open "$HOME/Applications/Claude RTL.app"
```

### Claude diagnostics

Claude crashes instantly with `--remote-debugging-port`, and the patched copy has
no Node inspector fuse — there is no CDP path into it. To see what the runtime
does inside the app:

1. Add temporary `console.log` lines in `runtime/rtl-runtime.js`.
2. Launch with renderer console forwarded to a log:

```bash
ELECTRON_ENABLE_LOGGING=1 "$HOME/Applications/Claude RTL.app/Contents/MacOS/Claude" > /tmp/claude-rtl.log 2>&1 &
```

3. Grep the log, then remove the temporary logging.

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

The Codex target does not create a separate RTL app. It launches the normal
`/Applications/ChatGPT.app` process and injects RTL into that running process.
Opening ChatGPT from its regular icon while that process is still running shows
the same injected UI. To return to a non-injected session, quit ChatGPT completely
and open it normally instead of through the RTL launcher.

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
/Applications/ChatGPT.app
~/Applications/Claude RTL.app
```

OpenAI renamed the Codex desktop app to ChatGPT in version 26.707.41301. The
`codex` runtime target supports both the current `ChatGPT.app` bundle and the
legacy `Codex.app` bundle during the migration.

## When To Reinstall

### Claude: restart for content, reinstall for installer

Restart `Claude RTL.app` (no reinstall) after changing:

- `runtime/rtl.css`
- `runtime/rtl-classifier.js`
- `runtime/rtl-runtime.js`
- `profiles/claude.json` / `profiles/claude.local.json`

Reinstall (`./run-rtl.sh claude --reinstall`) only after changing:

- `claude-installer.mjs`

Claude app updates are handled automatically: `./run-rtl.sh claude` rebuilds
the copy when `/Applications/Claude.app` changed.

### Codex does not require reinstall

For Codex, rerunning:

```bash
./run-rtl.sh codex
```

is enough after:

- CSS changes
- runtime logic changes
- Codex profile changes

## First Debug Path

If the issue is in Claude:

1. Verify whether the problem is reproducible in `Claude RTL.app`.
2. Check local override values in `profiles/claude.local.json`.
3. After changing runtime/CSS/profile, restart `Claude RTL.app` (no reinstall).
4. If classification looks wrong, use the Claude diagnostics flow above
   (`ELECTRON_ENABLE_LOGGING=1` + temporary logging).

If the issue is in Codex:

1. Run `./run-rtl.sh codex --diagnostics`.
2. If needed, run `./run-rtl.sh codex --dump-html --diagnostics`.
3. Check local override values in `profiles/codex.local.json`.

## Rule For Future Agents

Do not guess how to launch the project.

Use the commands in this file first.
