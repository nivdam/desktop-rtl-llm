# Plan

## Goal

Keep Hebrew rendering stable in desktop LLM apps while minimizing manual steps and app-specific breakage.

## Claude Plan

### Current state

- usable
- depends on `Claude RTL.app`
- requires reinstall after changes
- more fragile than Codex

### Short-term plan

1. Keep the wrapper model stable.
2. Avoid unnecessary reinstalls.
3. Prefer small app-specific CSS or classification fixes.
4. Treat repeated Keychain prompts as an expected side effect of the current model.

### Medium-term options

Option A:

Keep the current patched-copy approach.

Option B:

Investigate whether Claude can move to a cleaner runtime-injection model.

Current recommendation:

Keep the current model until there is a concrete reason to replace it.

## Codex Plan

### Current state

- good
- injection-based
- no copied app needed
- diagnostics and DOM dump are already useful

### Short-term plan

1. Keep Codex on runtime injection.
2. Keep local overrides small and explicit.
3. Use diagnostics before editing CSS.
4. Use DOM dumps for headings, tables, lists, and inline markdown before changing broad selectors.

### Medium-term plan

1. Make classification more robust before reducing app-specific CSS.
2. Keep DOM dump support.
3. Use Codex as the reference architecture for future desktop RTL work.

## Shared Plan

### Keep

- app-specific targeting when needed
- local overrides outside tracked defaults
- small fixes with diagnostics-first workflow

### Avoid

- global CSS rewrites without evidence
- disabling `wrapTextNodes` for Claude without a concrete DOM example that proves it is still safe
- assuming Claude and Codex can share the exact same DOM strategy
- treating class-name fragments like `InlineCode` as proof that a block element is code

## Handoff Rule

Before making runtime changes:

1. identify the app
2. run diagnostics
3. inspect classification
4. prefer the smallest change that explains the bug
