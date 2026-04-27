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

Local overrides are app-specific.

Reason:

- Claude keeps wrapping enabled because mixed Hebrew/English sentences often need explicit segmentation.
- Codex keeps wrapping disabled because the extra wrappers caused worse mixed-text ordering there.

### Mixed LTR/RTL classification

`rtl-runtime.js` was adjusted so a message that starts with English but contains enough Hebrew can still be treated as RTL.

This matters for:

- file paths at the start of a sentence
- inline code before Hebrew prose
- list items that begin with English identifiers

Block children inside an RTL-rendered message can also inherit RTL context. This prevents Codex list items or table cells that start with English from jumping to the opposite side when they still contain Hebrew.

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
