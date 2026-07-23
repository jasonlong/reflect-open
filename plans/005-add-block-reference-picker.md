# Plan 005: Add a block picker and reference-authoring UX

> **Executor instructions**: Build the source-side workflow missing from Plan 004: users must be able to find an existing block from where they are writing, select it with the keyboard, safely mint its ID if needed, and insert a reference. Never mutate a candidate merely because it appears in search results. Revalidate against live source at selection time and refuse stale/ambiguous targets.
>
> **Drift check (run first)**:
> `git diff --stat cedba83c..HEAD -- packages/core/src/indexing packages/core/src/markdown apps/desktop/src/editor apps/desktop/src/components/command-palette apps/desktop/src/components/templates apps/desktop/src/components/ui apps/desktop/src/lib/commands apps/desktop/src/lib/note-task.ts apps/desktop/src/providers`
>
> Plans 001–004 must be DONE. Confirm `blocks`/`blocks_fts`, `NoteEditorHandle.setBlockId`, `noteEditorHandleFor`, `openSession`, and **Copy block reference** exist.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-add-meowdown-block-identity-support.md`, `plans/003-index-blocks-and-link-fragments.md`, `plans/004-ship-block-navigation-and-backlinks.md`
- **Category**: direction
- **Planned at**: commit `cedba83c`, 2026-07-22

## Why this matters

Plan 004 supports a target-first workflow—visit a block, copy its reference, return, paste—but modern tools such as Tana and Workflowy make the source-first path feel native: invoke a picker while writing, search remembered words, see note/breadcrumb context, and insert the selected block without leaving the current thought. IDs remain an invisible persistence detail. Because Reflect uses on-demand Markdown IDs rather than invisible IDs on every block, selection must also mint identity safely across open and closed notes.

## Current state

- Plan 003 projects every list block, including unaddressed blocks, and includes `blocks_fts` for text/breadcrumb search.
- `apps/desktop/src/components/templates/template-picker.tsx` demonstrates the existing `CommandDialog` provider/picker pattern and keyboard behavior.
- `apps/desktop/src/components/ui/command.tsx` supplies the local shadcn/cmdk primitive; do not hand-roll a dialog or listbox.
- `apps/desktop/src/editor/note-editor.tsx` exposes `insertMarkdown()` and Plan 002's locator-based block-ID mutation.
- `apps/desktop/src/editor/editor-handle-registry.ts` finds mounted editors by note path.
- `apps/desktop/src/editor/open-documents.ts` finds live sessions so writes never race unsaved buffers.
- `apps/desktop/src/lib/note-task.ts` is the proven session-or-disk, per-path-serialized, stale-anchor-guarded mutation pattern.
- `apps/desktop/src/lib/commands/types.ts` opens provider-owned pickers through narrow `CommandContext` capabilities.
- `apps/desktop/src/editor/use-template-slash-items.ts` is the pattern for exposing a picker from Meowdown's slash menu.

Target workflow:

1. While editing, run **Insert block reference…** from the command palette or choose **Reference block** from `/`.
2. Type remembered words.
3. Results show block text, source note, and breadcrumbs; arrow keys move and Enter selects.
4. If the block already has an ID, insert immediately. If not, Reflect revalidates the live block and mints/persists its ID.
5. Insert `[[Readable Note#^id|Human block label]]`; live preview shows only the label.
6. The current editor stays focused; users never need to visit the source block.

Selecting an unaddressed block intentionally counts as an explicit ID-minting action. Highlighting, scrolling, opening, or cancelling does not.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Core search/edit tests | `pnpm test --run packages/core/src/indexing/queries-blocks.test.ts packages/core/src/markdown/block-address.test.ts packages/core/src/markdown/edit-block-id.test.ts` | all pass; use actual Plan 003 query filename |
| Mutation tests | `pnpm test --run apps/desktop/src/lib/note-block-reference.test.ts apps/desktop/src/editor/note-session.test.ts apps/desktop/src/editor/note-editor.test.tsx` | all pass |
| Picker tests | `pnpm test --run apps/desktop/src/components/blocks/block-picker.test.tsx apps/desktop/src/providers/block-picker-provider.test.tsx apps/desktop/src/editor/use-block-slash-items.test.ts` | all pass |
| Command tests | `pnpm test --run apps/desktop/src/lib/commands/app-commands.test.ts apps/desktop/src/routing/app-shortcuts.test.tsx` | all pass |
| Full checks | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `packages/core/src/indexing/queries-blocks.ts` search additions and tests
- `packages/core/src/markdown/edit-block-id.ts` and tests
- `packages/core/src/markdown/index.ts`, `packages/core/src/index.ts`
- Plan 003's `blocks_fts` write/dev/parity fixtures if implementation drift left gaps
- `apps/desktop/src/lib/note-block-reference.ts` and tests
- a shared per-note write serializer extracted from `note-task.ts` only if needed to avoid parallel maps
- narrow `NoteSession`/editor-handle APIs needed for locator-based ID commits
- `apps/desktop/src/components/blocks/block-picker.tsx` and tests
- `apps/desktop/src/providers/block-picker-provider.tsx` and test
- workspace provider composition
- `apps/desktop/src/lib/commands/{types,app-commands}.ts` and tests
- `apps/desktop/src/editor/use-block-slash-items.ts` and tests
- `apps/desktop/src/editor/note-editor.tsx` only to compose slash items/delegate APIs
- query invalidation/key helpers
- `docs/block-addressing.md`

**Out of scope**:

- Block-level tags or tag filtering.
- Rendering transclusions (Plan 006).
- Exposing `/Embed block` before Plan 006's renderer ships.
- `((` trigger syntax, fuzzy semantic/embedding search, or a general block search screen.
- Editing a source block through its reference.
- Automatically minting IDs for search results, hover previews, or indexing.
- A custom overlay primitive.

## Git workflow

- Rebase on `upstream/master` after Plan 004 lands; push the topic branch only to `origin`.
- Branch: `feat/block-reference-picker`.
- Suggested commits: FTS query/edit primitive; session-safe address service; picker/provider; commands/slash UX.
- PR title: `feat: insert references to existing note blocks`.
- Open a fork-local ready-for-review PR targeting `jasonlong/reflect-open:master`; never push to the upstream remote.

## Steps

### Step 1: Add bounded block search

Extend Plan 003's block query module:

```ts
export interface BlockSearchResult {
  readonly path: string
  readonly noteTitle: string
  readonly dailyDate: string | null
  readonly ordinal: number
  readonly blockId: string | null
  readonly text: string
  readonly breadcrumbs: readonly string[]
}
```

Add `searchBlocks(query, options)` with a hard maximum (default 30, maximum 100):

- non-empty queries use parameterized FTS5 prefix search over block text, breadcrumbs, and source note title;
- join `notes` for display title/date and exclude templates;
- rank block-text matches above note-title matches, then breadcrumb-only matches, current note, recent notes, and document order;
- one block appears once even if multiple terms match;
- strip/sanitize FTS operator syntax through the existing search-token helper rather than interpolating raw input;
- an empty query returns a bounded useful set from current note followed by recently updated notes—never the whole graph;
- include private notes because this is an entirely local picker;
- return ID markers nowhere in display fields.

Do not use semantic retrieval: block content from private notes must never require an embedding/provider, and deterministic lexical matching is sufficient.

**Verify**: tests cover text/breadcrumb/title context, current/recent ranking, nested blocks, daily/private notes, punctuation/quotes, templates, limit, empty query, and duplicate text across notes.

### Step 2: Add a stale-safe pure ID edit

Create a documented locator and edit primitive:

```ts
export interface BlockLocator {
  readonly ordinal: number
  readonly expectedText: string
}

export type EnsureBlockIdResult =
  | { readonly kind: 'existing'; readonly id: string; readonly source: string }
  | { readonly kind: 'assigned'; readonly id: string; readonly source: string }
```

`ensureBlockId(source, locator, proposedId?)` must parse current source and require the same ordinal and normalized display text. If the target moved/changed, an ID is duplicated, or a proposed ID collides, throw a specific stale/ambiguous error. If the block already has a unique ID, return it without changing bytes. Otherwise generate/validate an ID and insert the suffix at the parser-owned lead-line boundary while preserving line endings and nested content.

Do not relocate by “first block with matching text”; repeated bullets are common and first-match resolution is unsafe.

**Verify**: tests cover existing/assigned IDs, nested/task/ordered blocks, CRLF, repeated text, changed ordinal/text, duplicate IDs, collision retry, and byte-exact no-op.

### Step 3: Verify the locator-based editor contract

Use Plan 002's released `setBlockId({ordinal, expectedText}, id)` through `NoteEditorHandle`. Confirm it verifies locator/ID uniqueness, changes one node in one undoable transaction, preserves selection when targeting another block, emits `onDocChange` synchronously, and returns false on staleness/ambiguity.

Do not emulate a missing API by replacing the entire open document. If the released package lacks this contract, STOP and repair Plan 002 upstream first.

**Verify**: Meowdown and Reflect adapter tests cover another block, current block, nested block, repeated text, stale locator, selection preservation, and undo.

### Step 4: Generalize the session-or-disk address operation

Refactor `note-block-reference.ts` around:

```ts
ensureBlockAddress(input: {
  readonly notePath: string
  readonly locator: BlockLocator
  readonly indexedBlockId: string | null
  readonly generation: number
}): Promise<{ readonly id: string; readonly noteAddress: string }>
```

Serialize mutations per note path using one shared utility with task writes. At execution time:

- if the note is open, require its live session and mounted editor, verify ready/not protected/not conflicted, call locator-based editor mutation, then await session `flush()`;
- if closed, read current Markdown, run the pure edit, and write through `writeNote` with generation;
- even when the index says an ID exists, revalidate it against live source;
- never fall back to disk when an open session refuses—the live buffer owns the document;
- only resolve the readable note address after the source write is safe;
- surface stale/busy/write errors through operation feedback and make no source-editor insertion on failure.

An undo of the later reference insertion does not remove a newly minted target ID. Document this intentional behavior: identity may have acquired other references since assignment.

**Verify**: tests cover open dirty source, closed source, same source/destination editor, already-addressed no-write, stale index, concurrent selection, protected/loading/conflict state, write failure, and generation switch.

### Step 5: Build the accessible block picker

Follow `TemplatePicker` with `CommandDialog`, but keep query/ranking in the hook/core:

- title “Insert block reference”; description explains searching existing bullets;
- autofocus search input on desktop; normal dialog focus behavior on mobile without reopening the note keyboard beneath it;
- each result presents primary block text and secondary `Note title · breadcrumb › breadcrumb`; preserve the immediate parent when deep trails truncate, following Dotflowy's disambiguation pattern;
- visually distinguish daily dates through existing date formatting, not custom labels;
- loading, no-results, failed-search, and stale-selection states;
- Enter selects, Escape cancels, arrow keys navigate, and focus is trapped by the existing dialog;
- before mutating the target, revalidate that the captured destination note/editor still owns the picker; then run the address operation, format `[[noteAddress#^id|human label]]` through Plan 004's shared sanitizer, insert it with `NoteEditorHandle.insertMarkdown`, close, and restore source-editor focus only after both succeed;
- while assignment is pending, disable selection and prevent double insertion;
- if the source editor disappeared/protected while the dialog was open, fail without mutating the target;
- cancelling performs zero writes.

Capture the destination note path/editor at open time and revalidate before mutation. A route change while the picker is open must close or fail safely rather than insert into a different note.

**Verify**: component tests cover keyboard-only use, ranking/context display, deep breadcrumb truncation, loading/error/empty, pending lock, cancel-no-write, stale target, lost destination, humanized insertion syntax/no visible ID, focus restoration, and mobile dialog behavior.

### Step 6: Expose command-palette and slash-menu entry points

Add `openBlockPicker()` to `CommandContext` through a provider patterned after note templates. Register **Insert block reference…** with keywords `block`, `reference`, `link`, `bullet`; no default global shortcut in v1.

Add a **Reference block** slash item that opens the same picker. Do not implement separate business logic in the slash callback. Both entry points require an editable mounted note and use existing operation feedback when unavailable.

Keep Plan 004's **Copy block reference** target-first action. The picker complements it; it does not replace it.

**Verify**: command and slash tests prove both call one provider action, protected/non-note views refuse, and registry/keybinding collisions remain absent.

### Step 7: Prepare—but do not expose—embed mode

Model picker intent as a small union (`reference | embed`) and keep result rows/address assignment reusable. Only `reference` is user-visible in this plan. Plan 006 will expose **Embed block…**, insert standalone `![[...]]`, and add **Copy block embed** after rendering is available.

Do not add disabled or teaser UI for embed mode.

### Step 8: Document and run all gates

Update `docs/block-addressing.md` with picker behavior, on-selection minting, stale refusal, and undo semantics. Run targeted tests, `pnpm check`, `git diff --check`, and inspect scope.

## Test plan

Required layers:

- core FTS ranking and bounded query;
- pure locator/ID mutation;
- Meowdown live-document mutation and selection preservation;
- session-or-disk persistence/concurrency;
- accessible picker interactions;
- command and slash integration.

Required end-to-end scenario: from Note A, search text from an unaddressed nested block in Note B, select it, persist `^id` in B, insert `[[B#^id|Readable block text]]` in A, verify live preview shows only the human label, then follow it to B's exact block.

## Done criteria

- [ ] Users can find existing blocks without navigating away from the source note.
- [ ] Results show block text, source note, and breadcrumb context.
- [ ] Selecting an unaddressed block safely mints/persists an ID exactly once.
- [ ] Open dirty target notes are mutated through their editor/session; disk writes never clobber them.
- [ ] The canonical reference is inserted at the source cursor with keyboard-only operation and renders without an ID.
- [ ] Cancellation/search performs no Markdown writes.
- [ ] Targeted tests and `pnpm check` pass.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Plan 003 lacks bounded lexical block search or indexes only addressed blocks.
- Locator-based mutation would choose the first repeated-text block.
- An open target note would require whole-document replacement or a direct disk write.
- Assigning another block's ID cannot preserve selection/undo in Meowdown.
- The picker must mint IDs while listing/highlighting rather than on explicit selection.
- Route changes could insert into a different destination note.

## Maintenance notes

The picker is the shared authoring surface for references and, in Plan 006, transclusions. Keep it as an additive provider/component patterned after the existing template picker rather than expanding or forking the global command palette. Keep search local and bounded. `BlockLocator` is a concurrency guard, not a durable address; never serialize it. If future ranking adds semantic search, private-note policy must be re-evaluated explicitly rather than inheriting note-level embedding behavior.
