# desktop-rtl-llm

Local RTL runtime for desktop LLM apps.

This project currently supports:

- Claude Desktop
- Codex Desktop

The goal is to make Hebrew render correctly in desktop chat UIs while keeping the original app installs untouched whenever possible.

## Current Architecture

There are two integration modes.

### Codex

Codex uses runtime injection against the normal installed app.

Main command:

```bash
./run-rtl.sh codex
```

Debug command:

```bash
./run-rtl.sh codex --diagnostics
```

Optional DOM dump:

```bash
./run-rtl.sh codex --dump-html --diagnostics
```

### Claude

Claude currently uses a separate local copied app:

```text
~/Applications/Claude RTL.app
```

The original `/Applications/Claude.app` is not modified.

Main commands:

```bash
./run-rtl.sh claude --install
./run-rtl.sh claude --reinstall
./run-rtl.sh claude --status
./run-rtl.sh claude --uninstall
```

Launch:

```bash
open "$HOME/Applications/Claude RTL.app"
```

## Repo Layout

```text
run-rtl.sh
inject-runtime.mjs
claude-installer.mjs
runtime/
profiles/
docs/
```

## Important Notes

- `profiles/*.local.json` are ignored by git.
- `logs/` and `state/` are ignored by git.
- Claude requires reinstall after runtime or CSS changes.
- Codex does not require reinstall for normal runtime or CSS changes.

## Documentation

- [docs/RUNNING.md](./docs/RUNNING.md)
- [docs/RUNTIME.md](./docs/RUNTIME.md)
- [docs/PLAN.md](./docs/PLAN.md)

## Current Local Decisions

- `wrapTextNodes` is disabled locally for both Claude and Codex.
- App-specific CSS overrides exist for `[data-llm="codex"]` and `[data-llm="claude"]`.
- Mixed messages that start in English but contain enough Hebrew should remain RTL.
