# Runtime

## What This Project Owns

This repo owns the local RTL runtime code for desktop LLM apps.

The actual installed runtime may still exist here on the machine:

```text
$HOME/Library/Application Support/rtl-desktop-runtime
```

That installed copy is the currently active local deployment.

This repo is the tracked project version.

## Integration Models

### Codex

Codex uses runtime injection.

It does not require a copied app bundle.

Main behavior:

- find the correct target window
- inject style and runtime
- classify message blocks
- apply RTL/LTR behavior

Useful commands:

```bash
./run-rtl.sh codex
./run-rtl.sh codex --diagnostics
./run-rtl.sh codex --dump-html --diagnostics
```

### Claude

Claude uses a copied patched app bundle:

```text
~/Applications/Claude RTL.app
```

This exists because the clean DevTools-based path was blocked on this machine.

Useful commands:

```bash
./run-rtl.sh claude --install
./run-rtl.sh claude --reinstall
./run-rtl.sh claude --status
./run-rtl.sh claude --uninstall
```

## Key Runtime Decisions

### `wrapTextNodes`

Local overrides currently disable wrapping for both apps.

Reason:

- text-node wrapping fixed some cases early on
- later it became the main cause of broken mixed Hebrew/English layout
- disabling it fixed Codex and improved Claude

### Mixed LTR/RTL classification

`rtl-runtime.js` was adjusted so a message that starts with English but contains enough Hebrew can still be treated as RTL.

This matters for:

- file paths at the start of a sentence
- inline code before Hebrew prose
- list items that begin with English identifiers

### App markers

The runtime applies:

```html
data-llm="codex"
data-llm="claude"
```

on the document root.

This allows app-specific CSS targeting.

## CSS Model

The CSS is intentionally not fully generic.

Current app-specific overrides exist for:

- `[data-llm="codex"]`
- `[data-llm="claude"]`

These help force stable RTL message rendering where the base generic rules were not enough.

## Known Operational Tradeoffs

### Claude Keychain prompts

Claude may repeatedly request access to saved credentials after reinstall.

Reason:

- `Claude RTL.app` is a copied patched app
- macOS Keychain trust is tied to app identity and signing state
- reinstalling can invalidate previous trust

### Reinstall requirement

Claude changes require reinstall.

Codex changes usually do not.

## Debug Tools

### Diagnostics

`--diagnostics` reports:

- selected target
- whether style was injected
- whether runtime was injected
- classification counts
- computed message styles

### DOM dump

For Codex, `--dump-html` writes:

```text
state/codex-dom-dump.html
state/codex-dom-dump.json
```

This is the fastest way to separate:

- injection failure
- CSS failure
- classification failure
- wrapping failure
