# Plan 004: Ship block navigation, copy actions, and backlinks

> **Executor instructions**: Follow each step and run every verification command. Use the shared resolver/projection from Plan 003; do not reimplement address parsing in routes or components. Preserve current note navigation, daily-stream focus, new-window behavior, and session safety.
>
> **Drift check (run first)**:
> `git diff --stat cedba83c..HEAD -- apps/desktop/src/routing apps/desktop/src/editor apps/desktop/src/hooks apps/desktop/src/lib/deep-links apps/desktop/src/lib/commands apps/desktop/src/lib/note-deep-link.ts apps/desktop/src/components/backlink* apps/desktop/src/hooks/use-backlink* packages/core/src/indexing/queries-backlinks.ts docs/deep-links.md docs/block-addressing.md`
>
> Plans 001–003 must be DONE. Confirm the released `NoteEditorHandle` has active-block/ID/reveal methods and core exports `ResolvedWikiAddress` plus backlink fragment metadata.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-add-meowdown-block-identity-support.md`, `plans/003-index-blocks-and-link-fragments.md`
- **Category**: direction
- **Planned at**: commit `cedba83c`, 2026-07-22

## Why this matters

Plan 003 makes blocks resolvable but users still need product paths to create and follow those addresses. This plan carries fragments through routes/deep links/windows, reveals them after note load, adds keyboard-native copy actions that safely mint IDs through the live editor/session, and shows block targets in incoming backlinks. Normal UI stays human-readable: source suffixes and link fragments are storage details, not labels.

## Current state

- `apps/desktop/src/routing/route.ts:13-27` models daily/note routes without fragments; every exhaustive switch/equality helper assumes that shape.
- `apps/desktop/src/routing/router.tsx` owns history entries, arrival identity, scroll state, and move rewrites. Fragment arrivals must work with those mechanisms rather than mounting a second router.
- `apps/desktop/src/editor/note-editor.tsx:64-101` is Reflect's provider-neutral editor handle; Plan 002 extends it with block APIs.
- `apps/desktop/src/components/note-pane.tsx` receives the current document snapshot and registers editor handles.
- `apps/desktop/src/editor/use-wiki-link-navigation.ts` owns async wiki resolution, unresolved creation, stale intent, daily links, and modifier-click windows.
- `apps/desktop/src/lib/deep-links/parse.ts` parses `reflect://note/<target>`; `format.ts` emits route URLs; `handle.ts` resolves free-form targets.
- `apps/desktop/src/lib/note-deep-link.ts` mints/uses stable note IDs and copies only after the durable note identity exists.
- `apps/desktop/src/editor/editor-handle-registry.ts` resolves the mounted editor for a note path.
- `apps/desktop/src/lib/commands/types.ts` provides `notePath()` and index generation but not direct editor/session objects.
- `apps/desktop/src/lib/commands/app-commands.ts:234-251` is the pattern for a note-scoped clipboard command.
- `packages/core/src/indexing/queries-backlinks.ts` and `apps/desktop/src/components/backlinks-panel.tsx` are the one data/render path for incoming references.

Route contract:

```ts
export type NoteFragment =
  | { readonly kind: 'heading'; readonly value: string }
  | { readonly kind: 'block'; readonly id: string }
  | {
      readonly kind: 'blockPosition'
      readonly ordinal: number
      readonly expectedText: string
    }
```

`blockPosition` is transient and in-window only. Only heading/block-ID fragments serialize to Markdown, `reflect://`, or secondary windows.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Routing/deep-link tests | `pnpm test --run apps/desktop/src/routing apps/desktop/src/lib/deep-links apps/desktop/src/lib/windows/open-in-new-window.test.ts apps/desktop/src/lib/windows/initial-window-route.test.ts` | all pass |
| Editor/navigation tests | `pnpm test --run apps/desktop/src/editor/note-editor.test.tsx apps/desktop/src/editor/use-wiki-link-navigation.test.tsx apps/desktop/src/editor/use-wiki-link-hover-preview.test.tsx apps/desktop/src/components/note-pane.test.tsx` | all applicable tests pass |
| Command tests | `pnpm test --run apps/desktop/src/lib/note-block-reference.test.ts apps/desktop/src/lib/note-deep-link.test.ts apps/desktop/src/lib/commands/app-commands.test.ts` | all pass |
| Backlink tests | `pnpm test --run packages/core/src/indexing/queries-backlinks.test.ts apps/desktop/src/components/backlinks-panel.test.tsx apps/desktop/src/components/backlink-source-group.test.tsx` | all pass |
| Full checks | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `apps/desktop/src/routing/route.ts`, router, and focused route/history tests
- `apps/desktop/src/lib/deep-links/{deep-link,parse,format,handle}.ts` and tests
- secondary-window/deep-link route formatting/bootstrap files/tests
- `apps/desktop/src/editor/note-editor.tsx` and tests
- `apps/desktop/src/components/note-pane.tsx`
- a focused `apps/desktop/src/editor/use-note-fragment-reveal.ts` and tests
- `apps/desktop/src/editor/use-wiki-link-navigation.ts` and tests
- `apps/desktop/src/editor/use-wiki-link-hover-preview.tsx` and tests for block-target previews
- `apps/desktop/src/lib/note-block-reference.ts` and test
- `apps/desktop/src/lib/note-deep-link.ts` only to share block deep-link formatting/identity
- `apps/desktop/src/lib/commands/{types,app-commands}.ts` and tests
- open-document/session registry modules only for a safe explicit flush/ID mutation channel
- existing backlinks hooks/grouping/components and tests
- `packages/core/src/indexing/queries-backlinks.ts` only if UI-required metadata was not completed in Plan 003
- `docs/deep-links.md`, `docs/block-addressing.md`

**Out of scope**:

- Schema/projection changes (Plan 003).
- Searchable block-picker and reference insertion UX (Plan 005).
- Block-level tag behavior.
- Rendering embeds/transclusion (Plan 006).
- Default keyboard shortcut changes for existing commands.
- Editing via references or embeds.
- Automatically repairing/minting IDs outside explicit copy actions.

## Git workflow

- Fetch/rebase on `upstream/master` immediately before branching; push the topic branch only to `origin`.
- Branch: `feat/block-navigation`.
- Suggested commits: route/deep links; reveal/wiki navigation; copy actions; backlinks UI/docs.
- PR title: `feat: link directly to note blocks`.
- Open a fork-local ready-for-review PR targeting `jasonlong/reflect-open:master`; never push to the upstream remote.

## Steps

### Step 1: Carry note fragments through product routes

Add optional `fragment: NoteFragment | null` to both concrete note routes. Update structural equality, normalization, current-note helpers, router history, move rewriting, and exhaustive switches.

Rules:

- navigating to the same note with a different fragment is a real arrival and updates history;
- repeating the identical route/fragment is a no-op unless callers explicitly request re-arrival;
- note rename/move rewrites path while preserving fragment;
- `blockPosition` may exist in in-memory history but cannot leave the process;
- route helpers that do not care about fragments must preserve them rather than reconstructing a fragmentless route accidentally.

**Verify**: route/router tests cover heading/block/position equality, same-note new fragment, back/forward, note move, daily route, and malformed normalization.

### Step 2: Format and parse durable fragment deep links

Extend `reflect://note/<target>#Heading` and `#^block-id`. Parse the URL fragment separately from the percent-decoded path argument. Keep exact note targets containing `#` representable through percent encoding in the path portion.

Update `DeepLink` types and handling so free-form note resolution retains the fragment on the resulting route. Extend `deepLinkForRoute`, secondary-window open formatting, and initial-window parsing. `blockPosition` must not format; callers either open in-window or receive null.

Deep-link block targets use stable note ID/date/path logic from `deepLinkForNote`, never a readable title that could rename.

**Verify**: tests round-trip ID/path/date plus encoded heading, block ID, malformed/empty fragments, literal encoded `#` note targets, and new-window fallback.

### Step 3: Reveal the target exactly once after document readiness

Create `use-note-fragment-reveal.ts`. It observes explicit route arrival identity, target path/date, document ready state, and mounted editor handle. Call:

- `revealHeading(value)` for headings;
- `revealBlock({id})` for durable blocks;
- `revealBlock({ordinal, expectedText})` for positional hints.

Reveal once per explicit arrival. Do not re-run on incidental render/query invalidation. On false, leave the note open and show non-blocking feedback (“That heading/block is no longer available”). Do not focus on mobile during stack animation or raise the keyboard; reveal should select/scroll with existing platform behavior. Respect daily-stream focused-day and hidden-tab arrival rules.

**Verify**: hook/component tests cover delayed load/ref attach, same-note new fragment, back/forward, missing target, daily stream, no duplicate reveal, and mobile no-focus.

### Step 4: Make wiki-link navigation use the shared resolver

Update `useWikiLinkNavigation` to call Plan 003's exact-first resolver. Preserve today's intent guard, unresolved note creation, ambiguity feedback, dates, and modifier-click behavior.

Behavior:

- note result opens normally;
- heading result opens note + heading fragment even if the heading was later removed;
- block result opens note + block ID;
- missing/ambiguous block reports and does not create a bogus note;
- a full exact target miss with no resolvable base retains current unresolved-create behavior for the full target;
- secondary windows receive only durable fragments;
- hover preview for a valid block shows its current text plus note/breadcrumb context, never the ID; missing/ambiguous blocks show a compact unavailable state rather than previewing the whole note.

**Verify**: existing tests plus literal `#` title, heading, valid/missing/duplicate block, daily block, stale intent, modifier cases, and humanized block hover previews pass.

### Step 5: Add session-safe block-reference copy actions

Create `note-block-reference.ts` with one shared “ensure active block address” operation:

1. resolve current path through `CommandContext.notePath()` and editor through `editor-handle-registry`;
2. require `getActiveBlock()` list item;
3. if no ID, generate through Plan 001 and call editor `setActiveBlockId`;
4. flush the owning live `NoteSession` and await the landed write before returning an address;
5. if ID already exists, verify it is not duplicated in the current document/index;
6. preserve unsaved edits and refuse protected/loading/conflicted/disposed sessions;
7. on write failure, do not copy/claim success (normal editor undo remains available).

Add one shared formatter for app-authored references. Derive a display alias from `EditorBlock.text`: trim/collapse whitespace, flatten to one line, escape or replace wiki-alias delimiters through existing Markdown helpers, and truncate by Unicode code point to a documented UI limit. Empty text falls back to `Block in <Note title>`. Do not leak the ID into the alias.

Provide:

- **Copy block reference** → `[[Readable Note Title#^id|Human block label]]`;
- **Copy block deep link** → `reflect://note/<stable-note-id-or-date>#^id`.

Explicit aliases authored by users are preserved by parsing and renames; the generated alias is a readable snapshot, not a live copy. Current source text is available through hover preview. This avoids an async inline renderer and keeps the Markdown understandable in other tools.

Add command-palette entries without stealing `Alt-Mod-l` from note deep links. Use operation feedback and clipboard helpers. A non-list caret/no mounted editor is a no-op or clear feedback, never a disk mutation.

The open-documents/session registry may expose a narrow `flush()` accessor/action; do not import component state into command logic.

**Verify**: tests cover existing ID, mint+flush, daily note, note rename title source, empty/long/delimiter-rich/Unicode labels, no ID in labels, missing editor, non-list selection, duplicate ID, protected/conflict state, save failure, clipboard failure, and graph switch generation.

### Step 6: Render block-target metadata in incoming backlinks

Use Plan 003's backlink fragment fields. Extend grouping/dedupe keys to include target fragment. In the bottom backlinks panel:

- ordinary note refs remain visually unchanged;
- valid block refs get a compact muted label such as `to: Decision: keep Markdown…`;
- heading refs may show `to: Heading`;
- missing/ambiguous block refs remain present with `block unavailable` rather than disappearing;
- clicking the target label reveals that target in the current note without pushing duplicate history;
- source title/snippet links retain existing behavior and pagination.

Do not add per-block floating badges/gutter counts in this wave; the bottom panel remains the minimal ambient surface.

**Verify**: core/group/panel tests cover ordinary/heading/valid/missing/duplicate blocks, same source snippet to two target blocks, dedupe, pagination, and local private notes.

### Step 7: Document and run all gates

Update user-facing docs with Markdown refs, deep links, copy actions, exact-first compatibility, missing/duplicate behavior, and rename survival.

Run targeted tests, `pnpm check`, `git diff --check`, and inspect scope. Do not edit version/changelog/release manifests.

## Test plan

Use `route.test.ts`, router tests, deep-link format/parse/handle tests, `use-wiki-link-navigation.test.tsx`, `note-deep-link.test.ts`, command registry tests, and backlinks component tests.

Required coverage:

- route/history/window/deep-link durability;
- delayed/stale reveal;
- exact-first wiki navigation;
- session-safe ID mint and flush-before-copy;
- sanitized human reference labels and current block hover previews with no visible IDs;
- no shortcut collisions;
- backlink target labels and unresolved preservation;
- desktop/mobile focus behavior.

## Done criteria

- [ ] `[[Note#^id]]` opens exactly one target block or reports ambiguity.
- [ ] Heading/block fragments survive routes, history, windows, deep links, and note moves.
- [ ] Copy actions mint IDs only explicitly, await persistence, and produce human-labeled references with no visible ID.
- [ ] Missing/duplicate block refs never create or reveal the wrong target.
- [ ] Incoming backlinks identify block/heading targets without a new major UI surface.
- [ ] Targeted tests and `pnpm check` pass.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Plans 002/003 APIs are absent or materially changed.
- ID assignment would bypass the live session or lose unsaved edits.
- Daily/mobile reveal requires autofocus that raises the keyboard.
- `blockPosition` would have to serialize externally.
- Missing/duplicate blocks would be first-row resolved.
- Backlink grouping would drop unresolved source references.

## Maintenance notes

All wiki-link clicks, deep links, and future embeds must share Plan 003's resolver. Keep the upstream diff narrow: new helpers/components are additive; existing router, session, command, and backlinks modules receive only the minimum composition/delegation changes. Review copy actions for ordering: no clipboard success before the ID write lands. Keep `blockPosition` explicitly ephemeral; durable surfaces must use IDs. A future per-block backlink badge can consume the same query but should be a separate UX/performance plan.
