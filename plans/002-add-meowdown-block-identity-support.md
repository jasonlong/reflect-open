# Plan 002: Add block identity and reveal support to Meowdown

> **Executor instructions**: This is a two-repository plan. Implement and merge/release the Meowdown change first, then consume that release in Reflect. Follow each repository's instructions and keep the PRs separate. Run every verification command. If a STOP condition occurs, report instead of adding a Reflect-side workaround.
>
> **Drift checks (run first)**:
>
> - Reflect: `git diff --stat cedba83c..HEAD -- apps/desktop/src/editor apps/desktop/package.json packages/core/package.json pnpm-lock.yaml`
> - Meowdown: after cloning/opening `~/repos/meowdown`, record its HEAD and compare the current files named below against the excerpts in “Current state”.
>
> Plan 001 must be DONE. Read `docs/block-addressing.md` and use its exact syntax and editing semantics.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-establish-block-addressing-contract.md`
- **Category**: direction
- **Planned at**: Reflect commit `cedba83c`, 2026-07-22; Meowdown 0.57.0 surveyed at `35390be`

## Why this matters

Reflect's index can understand `^block-id`, but the editor must preserve that identity through normal editing, dragging, splitting, copying, undo, and serialization. A hidden Reflect-only decoration would create two competing Markdown models. Meowdown is first-party and deliberately coupled to Reflect, so list-node identity and reveal commands belong upstream in Meowdown, with Reflect consuming a released API.

## Current state

Meowdown repository: `https://github.com/prosekit/meowdown` (default branch `master`). The expected local checkout is `~/repos/meowdown`; clone it if absent, then read any live contributor instructions before editing.

At surveyed Meowdown 0.57.0 commit `35390be`:

- `packages/core/src/extensions/list.ts:58-73` defines `MeowdownListAttrs` with marker/task/gap fields but no block ID.
- `packages/core/src/converters/md-to-pm.ts:426-516` converts each Lezer `ListItem` into one flat ProseMirror `list` node and is the correct place to remove a trailing source marker into a node attr.
- `packages/core/src/converters/pm-to-md.ts:354-383` serializes the flat `list` node and is the correct place to append the marker back to the lead line.
- `packages/core/src/extensions/list.ts:124-180` shows the node-attribute pattern and clipboard attribute policy.
- `packages/react/src/components/types.ts:19-112` defines `EditorHandle`; it already exposes `revealHeading` but not block inspection/mutation/reveal.
- `packages/react/src/components/prosekit-editor.tsx:129-151,391-429` provides the model for resolving a heading to a ProseMirror position and exposing it through the handle.
- `packages/react/src/components/block-handle.tsx` currently renders only a draggable grip. Do not couple host-specific “copy Reflect reference” behavior into this generic component.
- Meowdown's required checks are `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` (`package.json`).

In Reflect:

- `apps/desktop/src/editor/note-editor.tsx:64-101` defines the Reflect-owned `NoteEditorHandle`; it wraps only part of Meowdown's handle.
- `apps/desktop/src/editor/note-editor.tsx:268-290` delegates those methods through `innerRef`.
- `apps/desktop/src/components/note-pane.tsx:342` enables Meowdown's block handle on desktop; touch surfaces disable it intentionally.
- `apps/desktop/src/editor/roundtrip.test.ts` and `note-editor.test.tsx` are the local fidelity/adapter test patterns.

Required upstream API shape (names may vary only if Meowdown maintainers request it; behavior may not):

```ts
export interface EditorBlock {
  readonly kind: 'listItem'
  readonly id: string | null
  readonly ordinal: number
  readonly text: string
}

export type BlockRevealTarget =
  | { readonly id: string }
  | { readonly ordinal: number; readonly expectedText: string }

interface EditorHandle {
  getActiveBlock(): EditorBlock | null
  setActiveBlockId(id: string): boolean
  setBlockId(target: { readonly ordinal: number; readonly expectedText: string }, id: string): boolean
  revealBlock(target: BlockRevealTarget): boolean
  refreshMarkdownRendering(): void // already exists upstream; Reflect must expose it
}
```

Behavior:

- `setActiveBlockId` changes the selected/caret list item as one undoable transaction, emits `onDocChange`, and refuses invalid IDs/non-list selections.
- `revealBlock({id})` succeeds only for exactly one matching node; duplicates return false.
- positional reveal uses document-order ordinal and verifies normalized `expectedText`; mismatch returns false rather than scrolling to the wrong block.
- splitting keeps the ID on the upper/original item; the new item has none.
- copy/paste creates new content and drops IDs; internal drag reorder preserves IDs.
- undo/redo restores ID mutations.
- the marker remains literal in Markdown but is never rendered beside the source block in normal live preview, including when the caret enters that block; only an explicit raw-source surface exposes it;
- an unaliased rendered wikilink whose target ends in a valid `#^id` hides the fragment and falls back to the note basename, while its click target/source Markdown remain unchanged. App-authored Reflect references provide a richer alias in Plan 004.

## Commands you will need

### Meowdown

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Targeted tests | `pnpm test --run packages/core/src/converters/md-to-pm.test.ts packages/core/src/converters/pm-to-md.test.ts packages/core/src/extensions/list.test.ts packages/react/src/components/prosekit-editor.test.tsx packages/react/src/components/markdown-view.test.tsx` | all pass; add the actual focused wikilink-label test filename if different |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Build | `pnpm build` | exit 0 |

### Reflect

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `pnpm test --run apps/desktop/src/editor/note-editor.test.tsx apps/desktop/src/editor/roundtrip.test.ts` | all pass |
| Checks | `pnpm check` | exit 0 |

Before using ProseKit block-handle APIs beyond Meowdown's current usage, fetch current ProseKit documentation through Context7. The documented public structure is `BlockHandleRoot → BlockHandlePositioner → BlockHandlePopup`, optionally containing add/drag controls. Do not depend on undocumented internal context to identify a hovered block.

## Scope

**Meowdown in scope**:

- `packages/core/src/extensions/list.ts`
- `packages/core/src/extensions/list.test.ts`
- `packages/core/src/converters/md-to-pm.ts`
- `packages/core/src/converters/md-to-pm.test.ts`
- `packages/core/src/converters/pm-to-md.ts`
- `packages/core/src/converters/pm-to-md.test.ts`
- a new focused block-identity/reveal module and tests if that keeps files single-purpose
- `packages/core/src/index.ts`
- `packages/react/src/components/types.ts`
- `packages/react/src/components/prosekit-editor.tsx`
- its existing or new colocated test
- `packages/react/src/components/editor.tsx` (the outer handle proxy)
- `packages/react/src/index.ts`
- the focused wikilink display-label helper/tests needed to hide valid block fragments from unaliased rendered links
- package README/API documentation and changelog generated through Meowdown's normal release process

**Reflect in scope after Meowdown release**:

- `apps/desktop/package.json`
- `packages/core/package.json` only if the matching `@meowdown/markdown` release is required
- `pnpm-lock.yaml`
- `apps/desktop/src/editor/note-editor.tsx`
- `apps/desktop/src/editor/note-editor.test.tsx`
- `apps/desktop/src/editor/roundtrip.test.ts`

**Out of scope**:

- Reflect routes, SQLite schema, tags, backlinks, block-reference commands, or transclusion.
- Host-specific clipboard text or a “Copy block reference” button in Meowdown.
- Addressable paragraphs/headings.
- In-place editing through embeds.
- A private fork, patch-package, vendored source, or Reflect-side parsing workaround.

## Git workflow

1. Meowdown branch: `feat/block-identities`; conventional PR title such as `feat: preserve addressable list block IDs`.
2. Push the branch only to a contributor fork. Never push directly to `prosekit/meowdown`; opening a cross-repository PR requires explicit user approval. A normal package release remains required before Reflect consumption.
3. Reflect branch after the package is available: `chore/update-meowdown-block-identities` or combine with the first Reflect feature branch if maintainers prefer. Update all three Meowdown packages to one version.
4. Push the Reflect branch only to `origin` and open a fork-local PR targeting `jasonlong/reflect-open:master`; never push to the upstream Reflect remote.

## Steps

### Step 1: Pin the Meowdown source model

Add `blockId?: string` to `MeowdownListAttrs` through a dedicated node attr extension. Use the same validity contract as `docs/block-addressing.md`; share/export a validator rather than copy regexes across converter/command code.

The attr must serialize into editor DOM only when required for DOM reparsing, but it must **not** be included in ordinary clipboard HTML. Copy/paste creates a new block and must not duplicate durable identity. Confirm drag reorder uses a move transaction rather than clipboard serialization; if it requires clipboard attrs to preserve IDs, STOP and design an explicit “internal drag preserves, external copy drops” channel before proceeding.

**Verify**: targeted `list.test.ts` cases prove DOM reparse retention and clipboard omission.

### Step 2: Parse and serialize the source suffix exactly

In `md-to-pm.ts`, detect a valid end-of-lead-line ` ^id` suffix on each list item. Remove the suffix from the lead paragraph/task text and put it in `blockId`. Do not recognize suffixes in code or nested inline syntax. Match Plan 001's fixtures; add shared fixture cases if practical.

In `pm-to-md.ts`, append ` ^id` to the end of the list item's lead physical line. Preserve list marker, task marker, indentation, child blocks, and line endings under existing normalizing rules. A parse→serialize cycle must be exact for canonical input and at worst “normalizing” for already-normalized variations; it must never be lossy.

Test ordinary, nested, ordered, collapsed, square checkbox, round task, wrapped, CRLF, and child-list cases.

**Verify**: converter tests pass and `checkRoundTrip` classifies representative block-ID Markdown as exact/normalizing, never lossy. Browser tests prove moving the caret into/out of an addressed block never flashes the `^id` suffix.

### Step 3: Implement block inspection and mutation commands

Add pure helpers over the ProseMirror document to enumerate flat `list` nodes in document order, derive display text, find the active list node from selection, find an ID uniquely, and verify an ordinal/text pair.

Expose `getActiveBlock`, `setActiveBlockId`, locator-based `setBlockId({ordinal, expectedText}, id)`, and `revealBlock` through both `ProseKitEditor` and the outer `MeowdownEditor` handle. The locator-based mutation is required by Plan 005's cross-note picker so selecting an existing unaddressed block does not require visiting it. Requirements:

- selection inside nested content identifies that nested list item;
- selection spanning more than one list item returns null/refuses mutation;
- duplicate IDs make ID reveal return false;
- setting the same ID is a no-op success without an extra history item;
- locator mutation requires both ordinal and expected display text and never relocates by first matching text;
- locator mutation preserves the current selection when assigning identity to another block;
- invalid/duplicate-in-document new IDs are refused;
- setting an ID is one undoable transaction and calls `onDocChange`;
- reveal sets a near text selection and scrolls into view, like `revealHeading`.

**Verify**: browser/component tests cover every requirement and pass.

### Step 4: Hide technical fragments from normal link rendering

For a rendered, unaliased wikilink with a syntactically valid block fragment, use the target note's basename as the fallback chip label and keep the complete target as the click/navigation payload. Explicit aliases always win. Ordinary note/heading links remain unchanged. This rule must be pure and host-neutral; do not query Reflect's index from Meowdown.

Tests must prove `[[Architecture#^k7m2q9ab]]` renders “Architecture,” never the ID; `[[Architecture#^k7m2q9ab|Storage decision]]` renders the alias; clicking either emits the full original target; invalid `#^` text and ordinary `#Heading` retain existing behavior; raw Markdown round-trips exactly.

**Verify**: editor and `MarkdownView` tests pass in hide/live-preview modes and no Reflect-specific code enters Meowdown.

### Step 5: Pin split, join, copy, drag, and undo semantics

Add behavioral tests before accepting the API:

- split a block before/middle/after text: original upper item retains the ID; new lower item has none;
- copy/paste an addressed item: pasted copy has no ID;
- drag an addressed item with children: moved item and subtree keep the ID;
- undo/redo ID assignment and drag preserve expected IDs;
- joining/deleting an addressed item removes its ID rather than transferring it silently;
- duplicate source IDs remain representable after parsing, while `revealBlock({id})` refuses ambiguity.

If ProseKit's generic split duplicates or loses attrs and cannot be corrected with a focused Meowdown command/plugin, STOP. Do not ship unstable identity.

**Verify**: targeted tests pass in Chromium and WebKit where the existing suite supports browser projects.

### Step 6: Review the upstream compatibility budget and release Meowdown

Before opening the PR, verify the diff remains generic and narrowly additive:

- no imports, labels, syntax assumptions, or styles named for Reflect;
- one list-node attribute and focused converter/command helpers rather than a forked list extension;
- public provider-neutral handles, not access to ProseKit internals from Reflect;
- no changes to default behavior for Markdown without a valid block suffix;
- no broad formatter/generated-file churn beyond the normal package release;
- separate commits for source-model support and React-handle exposure if that improves upstream review.

Update README/API docs. Run all Meowdown checks. Open the PR, wait for approval/CI, and release through the repository's normal release workflow. Record the released version in the Reflect PR description.

**Verify**: npm/package artifact contains the new types and behavior; no local path override is required.

### Step 7: Consume the release in Reflect

Update `@meowdown/core`, `@meowdown/react`, and `@meowdown/markdown` together if all were released. Extend Reflect's `NoteEditorHandle` and delegation with the new block APIs and existing `refreshMarkdownRendering`. Use Reflect-owned aliases for payload types at the wrapper boundary so downstream plans do not import Meowdown types directly.

Add adapter tests proving delegation, plus a round-trip fixture for nested/task block IDs. Do not add user-facing commands yet.

**Verify**:

- targeted Reflect editor tests pass;
- `pnpm check` passes;
- `rg -n "link:|file:" package.json apps/desktop/package.json packages/core/package.json pnpm-lock.yaml` shows no local Meowdown override.

## Test plan

Meowdown tests are the contract. At minimum cover:

- all supported list/task variants;
- exact marker removal/re-emission and no visible marker on caret entry;
- valid unaliased block-fragment links hide the fragment while preserving navigation target;
- syntax exclusions;
- active nested block detection;
- locator-based assignment to another/repeated-text block with selection preservation;
- duplicate rejection;
- positional reveal staleness check;
- split/copy/drag/join/undo behavior;
- round-trip fidelity;
- Reflect wrapper delegation.

Use existing `list.test.ts`, converter tests, `move-block.test.ts`, `block-handle.test.tsx`, and `revealHeading` implementation as patterns.

## Done criteria

- [ ] Meowdown release preserves block IDs through edit/drag, drops them on copy, and never displays their source suffix or valid link fragment in normal live preview.
- [ ] Meowdown exposes tested active-block, locator-based ID mutation, and reveal APIs.
- [ ] Split/join/duplicate semantics match `docs/block-addressing.md`.
- [ ] Reflect consumes a released package version, not a workaround.
- [ ] Reflect's wrapper exposes provider-neutral block methods and refresh.
- [ ] All Meowdown checks and Reflect `pnpm check` pass.
- [ ] Both PRs are ready for review/merged according to maintainer direction.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Plan 001's syntax contract is not approved or changed materially.
- Internal drag cannot preserve IDs without making ordinary copy/paste duplicate them.
- Split behavior cannot deterministically keep the ID on the original upper item.
- Supporting the suffix requires a second canonical document format or a lossy conversion.
- The required API depends on undocumented ProseKit internals.
- A Meowdown release cannot be produced; do not patch Reflect locally.

## Maintenance notes

Review the Meowdown change as a persistence change, not visual polish. Keep local `master` aligned with its upstream; push the topic branch only to a contributor fork. Do not push to the upstream repository, and pause for explicit user approval before any cross-repository PR. Any future list transform must preserve or deliberately delete `blockId`; tests should join the core list conformance suite. Reflect should never parse editor internals directly—the Markdown parser remains authoritative for indexing, and the editor API is only for current selection/mutation/reveal.
