# Runtime

## What This Project Owns

This repo owns the local RTL runtime code for desktop LLM apps.

This repo is the only deployment. The old copy at
`$HOME/Library/Application Support/rtl-desktop-runtime` was a stale
April 2026 deployment and was deleted on 2026-06-11. The Spotlight
launchers and `Claude RTL.app` are built from this repo directly.

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

The patch lives in the Electron main process (`.vite/build/index.pre.js`).
On every window load it reads `runtime/rtl-classifier.js`, `runtime/rtl-runtime.js`,
`runtime/rtl.css`, and `profiles/claude*.json` from this repo and injects them
via `webContents.insertCSS` + `webContents.executeJavaScript` — the same
execution model as the Codex CDP injection. Copies baked at install time act
as a fallback when the repo files are unreadable.

Practical consequence: runtime/CSS/profile changes only need an app restart.
Reinstall is needed only for `claude-installer.mjs` changes or Claude app updates
(the launcher rebuilds automatically on app updates).

Useful commands:

```bash
./run-rtl.sh claude --install
./run-rtl.sh claude --reinstall
./run-rtl.sh claude --status
./run-rtl.sh claude --uninstall
```

## Key Runtime Decisions

### `wrapTextNodes`

Local overrides are app-specific.

Current local state: `wrapTextNodes` is disabled for both Claude and Codex
via `profiles/*.local.json`. The extra wrappers caused worse mixed-text
ordering in Codex, and Claude was later switched off as well. The tracked
default in `profiles/claude.json` remains `true`; the local override wins.

### Mixed LTR/RTL classification

`rtl-runtime.js` was adjusted so a message that starts with English but contains enough Hebrew can still be treated as RTL.

This matters for:

- file paths at the start of a sentence
- inline code before Hebrew prose
- list items that begin with English identifiers

Block children inside an RTL-rendered message can also inherit RTL context. This prevents Codex list items or table cells that start with English from jumping to the opposite side when they still contain Hebrew.

### Lists

Lists are classified as a single unit: the `ul`/`ol` is itself a candidate, and a
block element inside an `li` (such as a `<p>`) does not disqualify it. All items of
an RTL-classified list share one right-hand marker column and right alignment, so
mixed Hebrew/English lists do not zigzag.

In Claude, items the classifier marked RTL get `unicode-bidi: isolate` instead of
`plaintext` — plaintext rebases on the first strong character, which flips
Hebrew-dominant items that open in English. Codex reaches the same result with RLM
anchors inserted at the start of RTL blocks.

### Claude DOM (1.11847+)

Claude desktop renamed its markdown container from `.standard-markdown` to
`.epitaxy-markdown` (verified live: the old class no longer exists in the DOM).
`profiles/claude.json` tracks the current class only. If lists/tables silently
stop being classified after a Claude update, check this class name first
(diagnostics flow in `RUNNING.md`).

Codex headings need special care: Codex uses heading classes that contain `InlineCode` in the class name. The runtime must not classify block headings as inline code just because their class name contains that substring.

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

Tables and lists intentionally have explicit resets for both logical and physical spacing. Some desktop app DOM uses Tailwind-style physical classes such as `pl-*`, `pr-*`, or `text-left`, so logical properties alone are not enough.

## Known Operational Tradeoffs

### Claude Keychain prompts

Claude may repeatedly request access to saved credentials after reinstall.

Reason:

- `Claude RTL.app` is a copied patched app
- macOS Keychain trust is tied to app identity and signing state
- reinstalling can invalidate previous trust

### Claude updates and Workspace/Cowork

`Claude RTL.app` is ad-hoc signed after patching. It should not be treated as the primary Claude install.

Use the original `/Applications/Claude.app` for app updates. After the original app updates, rebuild the RTL copy with:

```bash
./run-rtl.sh claude
```

The launcher checks the source app hash and rebuilds `Claude RTL.app` automatically when the original app changed.

Claude Workspace/Cowork features can require restricted macOS virtualization entitlements. The patched ad-hoc-signed copy can still fail those checks even when the entitlement key is present in the local signature. Use the original Claude app for those features.

### Reinstall requirement

Claude runtime/CSS/profile changes require only an app restart (assets are
read from the repo at launch). Reinstall is needed only for installer/bootstrap
changes or Claude app updates.

Codex changes never require reinstall; rerun the launcher.

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
