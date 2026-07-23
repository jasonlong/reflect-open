# Plan 006: Render and author read-only block transclusions

> **Executor instructions**: This plan spans Meowdown and Reflect. Start with the explicit Meowdown feasibility gate in Step 1. Do not implement a DOM/CSS illusion that produces invalid editor structure, and do not add editing-through-embed. Merge/release upstream support before consuming it in Reflect.
>
> **Drift checks (run first)**:
>
> - Reflect: `git diff --stat cedba83c..HEAD -- packages/core/src/indexing packages/core/src/markdown apps/desktop/src/editor apps/desktop/src/components apps/desktop/src/hooks apps/desktop/package.json packages/core/package.json pnpm-lock.yaml`
> - Meowdown: compare its live `master` against the files listed below and record the new HEAD.
>
> Plans 001–005 must be DONE. Read `docs/block-addressing.md`; verify `![[Note#^id]]` is indexed as a block reference and the shared block picker can resolve/mint an address before adding rendering.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-add-meowdown-block-identity-support.md`, `plans/003-index-blocks-and-link-fragments.md`, `plans/004-ship-block-navigation-and-backlinks.md`, `plans/005-add-block-reference-picker.md`
- **Category**: direction
- **Completion**: DONE on the fork-local linear `block-ref` stacks; no upstream refs or PRs were created.
- **Planned at**: Reflect commit `cedba83c`, 2026-07-22; Meowdown 0.57.0 surveyed at `35390be`

## Why this matters

A block reference becomes transclusion when the target content is rendered inline while retaining one source of truth. Reflect already parses `![[...]]` as a wiki embed/reference, but unresolved note embeds remain literal and Meowdown's existing resolver supports only image, file, or note-chip atoms. This plan adds a read-only standalone block transclusion that updates from the source note, links back to it, handles cycles/missing targets, and never creates a second editable copy. Its visual model follows Workflowy/Dotflowy mirrors rather than a document card: native content first, quiet provenance on interaction. It also activates the shared picker in embed mode so users can find and transclude an existing block without typing syntax.

## Current state

Meowdown at surveyed 0.57.0 commit `35390be`:

- `packages/markdown/src/wiki-embed.ts` parses `![[target]]` as an inline `WikiEmbed`.
- `packages/core/src/extensions/wiki-embed.ts:14-44` defines resolution kinds `image | file | note`; no content/block kind exists.
- `packages/core/src/extensions/inline-text-to-mark-chunks.ts:465-490` applies the synchronous pure resolver during inline parsing.
- `packages/react/src/components/editor.tsx:180,437` and `markdown-view.tsx:118-146` accept `resolveWikiEmbed`.
- `packages/react/src/components/markdown-view.tsx` is the read-only renderer and already handles host callbacks for links/tasks/assets.
- `EditorHandle.refreshMarkdownRendering()` exists and reparses with creation-time resolvers, but async host rendering should not require rebuilding the editor.

Reflect:

- `packages/core/src/markdown/wiki-nodes.ts` treats both `Wikilink` and `WikiEmbed` as links, so `![[Note#^id]]` should already participate in backlinks after Plan 003.
- `apps/desktop/src/editor/note-editor.tsx` currently does not pass `resolveWikiEmbed` or a block renderer to Meowdown.
- `apps/desktop/src/editor/markdown-preview.tsx` and `apps/desktop/src/components/backlink-snippet.tsx` use `MarkdownView` and are patterns for safe read-only rendering.
- `apps/desktop/src/lib/read-existing-note-source.ts` reads a live open session when available, otherwise disk. Use it so the embed never bypasses unsaved source content with a stale DB snapshot.
- Plan 003's `blocks` projection supplies fast target resolution and display metadata, but Markdown remains authoritative.
- `private: true` blocks external services, not local display. A private block may render locally, but no publisher/AI/export expansion may inline it externally.

First-wave behavior:

1. Only a `![[Note#^id]]` that is the sole non-whitespace content of its paragraph becomes a block embed. Inline occurrences stay literal or render as the existing note-style chip; never insert block DOM inside an inline paragraph.
2. The embed shows the target list item's display Markdown including nested children, using the editor's native typography/list indentation and excluding its `^id` marker.
3. It is read-only. A subtle mirror affordance opens the source note; the content itself is not wrapped in a prominent always-on card/header. Tasks/links inside the preview are non-interactive in v1.
4. Missing base note, missing block, ambiguous note/block, and load errors render compact non-destructive placeholders preserving the authored target.
5. Embeds refresh after the target note's file/index event.
6. Recursion uses a visited address set and depth cap (default 3); a cycle renders “Nested block reference” rather than recursing.
7. Search, embeddings, AI context, gist publishing, export, and clipboard serialization use the authored `![[...]]` source only. They do not duplicate expanded target content.
8. Users can invoke **Embed block…** or `/Embed block`, search through the Plan 005 picker, and insert a structurally standalone embed without typing syntax.
9. A quiet mirror glyph/count opens “Appears in N places,” listing the source and other embed locations with human breadcrumbs. Hover/focus reveals a subtle boundary and source context; idle transclusions visually recede into the note.
10. Nested children may be collapsed per rendered instance without mutating the source Markdown or another instance's view state.

## Commands you will need

### Meowdown

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `pnpm test --run packages/core/src/extensions/wiki-embed.test.ts packages/core/src/extensions/wiki-embed-editor.test.ts packages/react/src/components/markdown-view.test.tsx` | all pass |
| Typecheck/lint/build | `pnpm typecheck && pnpm lint && pnpm build` | exit 0 |

### Reflect

| Purpose | Command | Expected on success |
|---|---|---|
| Core tests | `pnpm test --run packages/core/src/indexing/queries-blocks.test.ts packages/core/src/indexing/queries-block-places.test.ts packages/core/src/markdown/blocks.test.ts` | all pass; use actual Plan 003 query filenames |
| UI tests | `pnpm test --run apps/desktop/src/editor/note-editor.test.tsx apps/desktop/src/components/blocks/block-transclusion.test.tsx apps/desktop/src/components/blocks/block-places.test.tsx apps/desktop/src/editor/markdown-preview.test.tsx` | all pass; create missing focused tests |
| Full checks | `pnpm check` | exit 0 |

Fetch current ProseKit and Meowdown API docs before implementing new node/mark views. Treat trained-in ProseMirror/ProseKit API memory as stale.

## Scope

**Meowdown in scope**:

- `packages/core/src/extensions/wiki-embed.ts` and tests
- `packages/core/src/extensions/inline-text-to-mark-chunks.ts` only if the chosen model remains a valid inline atom
- parser/converter/schema files required to support a standalone block-backed embed while preserving literal source
- focused block-embed extension/view modules and tests
- `packages/core/src/index.ts`
- `packages/react/src/components/{editor,prosekit-editor,markdown-view}.tsx`
- `packages/react/src/components/types.ts`, `packages/react/src/index.ts`
- focused React block-embed component/styles/tests
- README/API docs and normal release metadata

**Reflect in scope after upstream release**:

- Meowdown package versions and `pnpm-lock.yaml`
- a focused `packages/core/src/indexing/resolve-block-embed.ts`/query module plus tests if Plan 003's resolver is insufficient
- `apps/desktop/src/components/blocks/block-transclusion.tsx` and test
- `apps/desktop/src/components/blocks/block-places.tsx` and test
- `apps/desktop/src/hooks/use-block-transclusion.ts` and test
- `apps/desktop/src/routing/route.ts` and focused tests for a transient embed-occurrence fragment
- Reflect/Meowdown editor handles for position-verified `revealWikiEmbed`
- a focused core embed-place query over Plan 003's `block_embed_places` source and tests
- `apps/desktop/src/editor/note-editor.tsx` and test
- `apps/desktop/src/editor/markdown-preview.tsx`
- `apps/desktop/src/components/backlink-snippet.tsx` only to prevent accidental recursive expansion there
- `apps/desktop/src/components/blocks/block-picker.tsx` and provider tests for embed mode
- `apps/desktop/src/lib/commands/{types,app-commands}.ts` and tests
- `apps/desktop/src/editor/use-block-slash-items.ts` and tests
- `apps/desktop/src/lib/note-block-reference.ts` only to reuse active-block address creation for Copy block embed
- central query invalidation helpers
- `docs/block-addressing.md`

**Out of scope**:

- Editing the source block through the embed.
- Interactive task toggles or nested link clicks inside the preview.
- Embedding headings/whole notes, paragraph blocks, remote content, or assets outside existing safe resolvers.
- Folding transcluded text into containing-note FTS, embeddings, AI context, exports, gists, or capture.
- Background auto-minting IDs or auto-repairing missing targets.

## Git workflow

- Meowdown work remains on `jasonlong/meowdown:block-ref` and is consumed through a fork-local release snapshot.
- Reflect work remains linear on `jasonlong/reflect-open:block-ref`; fork `master` stays pristine.
- Push only those fork branches. Do not create upstream refs or pull requests.

## Steps

### Step 1: Prove a structurally valid standalone embed in Meowdown

Time-box a focused upstream spike before expanding public APIs. Determine whether the existing inline `WikiEmbed` mark can render a standalone block without invalid DOM/selection behavior. Test these constraints:

- source paragraph contains only one `![[target#^id]]` plus whitespace;
- rendered content may contain nested lists;
- caret can move before/after the embed and reveal raw source in the appropriate mark mode;
- copy returns literal `![[...]]`, not expanded content;
- undo/redo and set/get Markdown remain exact;
- `MarkdownView` renders the same shape without mounting an editor.

Preferred API boundary:

```ts
export type WikiEmbedResolution =
  | ExistingKinds
  | { readonly kind: 'block'; readonly target?: string }

export interface WikiBlockEmbedRenderProps {
  readonly target: string
  readonly display: string
  readonly interactive: boolean
}

type WikiBlockEmbedRenderer = (props: WikiBlockEmbedRenderProps) => ReactNode
```

Core classifies the syntax; React hosts render content. Do not put React nodes/functions in core parse state. If an inline mark cannot validly host nested block content, implement a source-backed block node that serializes back to the exact literal paragraph. Do not use `display:block` CSS inside invalid `<p>` structure as a shortcut.

**Verify**: add a red/green structural test that inspects DOM nesting and exact Markdown serialization.

### Step 2: Implement and release the generic Meowdown host slot

Add the smallest generic API that supports a host-rendered, read-only standalone block embed. Keep the upstream compatibility budget explicit: Meowdown owns only source-backed structure, exact serialization, generic renderer/insertion hooks, selection, and clipboard semantics; Reflect owns querying, note provenance, places UI, styling, privacy, and routing. Requirements:

- classification is synchronous and pure;
- rendering may be React/stateful/async through the host component;
- unresolved embeds remain literal;
- inline block targets do not become block cards;
- renderer errors are contained and leave source editable;
- editor and `MarkdownView` share semantics;
- clipboard/source serialization remains literal;
- selection and keyboard navigation remain accessible;
- a generic `revealWikiEmbed({ordinal, expectedTarget})` handle supports verified place jumps without source offsets;
- no host-specific Reflect imports, styles, note-reading policy, place counts, or routing;
- Markdown without standalone block embeds follows the existing code path and DOM shape;
- focused additive modules/props rather than a parallel editor or broad node-view rewrite.

Add Chromium/WebKit component tests where available, update README/API docs, run all Meowdown checks, open/merge the PR, and publish a normal release.

**Verify**: released package declarations contain the new resolution kind and renderer prop; no patch-package/local override.

### Step 3: Add a live, exact-first Reflect block resolver

Create a focused hook/action taking the authored embed target and a visited-address context. Resolve through Plan 003's exact-first rules. For a valid unique block:

1. resolve note path + block ID from the index;
2. read current source through `read-existing-note-source` (live session first, disk fallback);
3. parse the current source and locate exactly one block ID;
4. return display Markdown/text/source route;
5. if index and source disagree, return unavailable and trigger/refetch through normal invalidation—never render the stale indexed `markdown` as authority.

Use TanStack Query with a key containing graph root, target path, and block ID. Watcher/index events must invalidate the target even when the containing note is unchanged. Do not send content outside the process.

Return a discriminated state: loading, resolved, missing note, missing block, ambiguous note, ambiguous block, cycle, error.

**Verify**: tests cover live session precedence, disk fallback, stale index, duplicate source IDs, deleted target, private target, and graph generation switch.

### Step 4: Render a native-looking Reflect transclusion

Create `BlockTransclusion` using existing design tokens/components and Meowdown `MarkdownView`. Do not build a card:

- native editor typography, list marker, indentation, line height, and vertical rhythm;
- no persistent source-note header, filled background, rounded container, or large border;
- a small mirror glyph/count remains discoverable without showing an ID;
- on hover or `:focus-within`, reveal a subtle hairline/outline plus source note and breadcrumb context;
- explicit source control supports click/Enter/Space and opens `{path, fragment:{kind:'block', id}}`; do not make every nested text click navigate unexpectedly;
- `interactive={false}` for nested Markdown so tasks/links cannot mutate/navigate independently;
- if the source subtree has children, an instance-local chevron may collapse/expand them without writing Markdown or affecting another instance;
- loading reserves stable native-line height rather than showing a large skeleton card;
- missing/ambiguous/error/cycle states preserve a human label and offer “Open note” only when a note path is known; never print the ID;
- `private: true` has no special local warning—the content is allowed locally;
- accessible name includes source note title and block text;
- no bespoke overlay primitive.

Render nested child Markdown exactly as Plan 001's `ParsedBlock.markdown` defines. Keep source ID hidden in all normal states, including hover/focus. Build a small desktop/mobile specimen with idle, hover/focus, collapsed, loading, and missing states and obtain maintainer sign-off before wiring the component broadly.

**Verify**: component tests cover native styling contract, idle versus hover/focus chrome, every resolver state, keyboard activation, independent collapse, no ID text, safe renderer options, and source navigation.

### Step 5: Wire editor and read-only renderers

Pass a stable syntax classifier/resolver and `renderWikiBlockEmbed` through Reflect's `NoteEditor`. The renderer component owns async data, so changing query state must not rebuild the uncontrolled editor or reset selection/undo.

Wire the same renderer into full-note `MarkdownPreview` only where it represents a local note. Do **not** expand block embeds inside backlink snippets by default: those snippets are already slices from another note, and recursive expansion would make a compact context unbounded. Keep the literal/chip there unless product review explicitly approves one-level expansion.

Ensure daily stream with multiple mounted editors does not issue duplicate reads for the same target; TanStack Query should dedupe.

**Verify**: editor tests show target updates re-render the transclusion without remounting the editor or changing selection/undo.

### Step 6: Activate polished embed authoring

Enable Plan 005's picker `embed` intent and expose it through:

- command palette: **Embed block…**;
- slash menu: **Embed block**;
- active-block command: **Copy block embed** → `![[Readable Note#^id]]`.

The picker uses the same results, context rows, stale revalidation, on-selection ID minting, pending lock, and destination capture as reference mode. Its title/description must say “Embed block,” not “Insert block reference.”

Add or consume a first-class Meowdown editor operation for inserting standalone block Markdown. It must place `![[...]]` as the sole non-whitespace content of its own paragraph in one undoable transaction from any caret/selection position, without relying on newline string tricks. The slash-menu path should replace its empty invocation block where appropriate; command-palette invocation should insert a standalone block adjacent to the caret's current block without deleting authored text.

Close only after address persistence and insertion succeed, restore editor focus, and render the native transclusion immediately. Undo removes the authored embed but deliberately leaves any target ID minted during selection.

Do not expose embed mode if standalone insertion or rendering is unavailable.

**Verify**: picker/editor tests cover addressed/unaddressed targets, command/slash entry, target-write failure, source disappearance, standalone structure from paragraph/list contexts, immediate native transclusion rendering, copy action, focus, and undo.

### Step 7: Add “Appears in N places”

Query Plan 003's resolved embed-only place source for the canonical target `(notePath, blockId)`. Return:

- one explicit source location;
- each resolved `![[...#^id]]` occurrence, including multiple occurrences in one note;
- human note title/date, local source path, and breadcrumb/context derived with the existing block-context parser;
- route information sufficient to jump to the source block or exact embedding occurrence;
- no raw IDs in display fields.

Do not count ordinary `[[...#^id|label]]` references as rendered places. Deduplicate only the same authored occurrence, not two intentional embeds in one note. Keep the query bounded/paginated if a target has many instances.

For embed-place jumps, add a transient in-window route fragment such as `{kind:'wikiEmbedPosition', ordinal, expectedTarget}`. The ordinal is document order among wiki embeds in the embedding note, derived from link positions at query time. Add a generic Meowdown `revealWikiEmbed` handle that enumerates rendered wiki embeds, verifies the expected target at that ordinal, scrolls/selects without exposing source syntax, and returns false on drift. Never serialize this positional fragment into Markdown, deep links, or secondary windows; stale failure opens the note and reports that the occurrence moved rather than revealing another target.

Render a compact existing shadcn dialog/popover opened from the mirror glyph/count. Follow Dotflowy's grammar: title “Appears in N places,” rows labeled Source or Transclusion, breadcrumbs that preserve the immediate parent when truncated, and keyboard-selectable jumps. The total is source + resolved transclusions. Missing/ambiguous embeds stay in backlinks but cannot claim to be a live place.

Do not add a graph-wide per-block badge query to every source bullet in this wave. The places affordance mounts only with a rendered transclusion; source-note inbound context remains available in the existing backlinks panel.

**Verify**: query/route/editor/component tests cover source + one/many places, same-note duplicates, ordinary-reference exclusion, exact embed reveal, stale positional refusal, no external serialization, rename/move, missing/ambiguous targets, deep breadcrumb truncation, pagination, keyboard navigation, and no ID display.

### Step 8: Add cycle and depth protection

Represent visited addresses as canonical `(notePath, blockId)` pairs, not authored aliases. Pass the set/depth through nested block renderers. At a repeat or depth > 3, render the cycle placeholder. The cycle guard is local render state, not SQLite data.

Tests:

- A embeds itself;
- A → B → A;
- A → B → C → D cap;
- same source block embedded twice as siblings is allowed (visited is per branch, not global page state).

**Verify**: cycle tests render bounded DOM and perform bounded reads.

### Step 9: Protect non-rendering surfaces

Add characterization tests proving:

- `ParsedNote.text` contains authored embed syntax behavior exactly as before and never target text;
- containing-note FTS/embedding chunks do not include expanded text;
- AI note context and asset tools do not expand block embeds;
- gist publishing/export/clipboard serialize authored `![[...]]` only;
- block embeds to private notes never leak through external-provider calls.

If any current generic renderer is reused by publishing/export and would now expand automatically, add an explicit local-render capability flag; default it off outside the editor/local preview.

**Verify**: targeted privacy/export/search tests pass.

### Step 10: Document and run all gates

Update `docs/block-addressing.md` with standalone-only syntax, read-only semantics, native/low-noise mirror presentation, “Appears in N places,” instance-local collapse, cycles/depth, update timing, missing behavior, hidden-ID rules, and the difference between reference and transclusion.

Run all Meowdown/Reflect gates, `git diff --check`, and scope inspection.

## Test plan

Meowdown:

- exact source round trip;
- valid DOM/block structure;
- standalone vs inline classification;
- editor selection/copy/undo;
- MarkdownView parity and renderer error containment.

Reflect:

- reference-picker reuse in embed mode and standalone insertion;
- native-content visual treatment, low-noise hover/focus provenance, and no IDs;
- embed-only “Appears in N places” counts/list/jumps;
- command/slash/copy authoring paths for addressed and unaddressed blocks;
- exact-first resolution and live-source verification;
- all resolver states;
- cache invalidation and editor non-remount;
- nested list rendering;
- cycle/depth bound;
- private local rendering and external non-expansion;
- mobile/desktop keyboard navigation.

## Done criteria

- [ ] Users can find and embed an existing block through the shared keyboard picker without typing syntax.
- [ ] **Copy block embed** and `/Embed block` use the same safe address operation.
- [ ] A standalone `![[Note#^id]]` renders source block Markdown and children with native editor styling and no visible ID.
- [ ] Idle transclusions use low-noise mirror chrome; hover/focus reveals provenance without a persistent card header.
- [ ] “Appears in N places” lists source and resolved transclusions with breadcrumbs and excludes ordinary references.
- [ ] The embed is read-only and navigates to its source.
- [ ] Inline/missing/ambiguous/cyclic embeds remain bounded and non-destructive.
- [ ] Source edits refresh without remounting the containing editor.
- [ ] Clipboard/search/embeddings/AI/export/gist surfaces do not inline target content.
- [ ] Private target content never reaches an external service through expansion.
- [ ] Meowdown and Reflect checks pass with released package versions.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Meowdown cannot represent or insert a standalone source-backed block embed with valid DOM and exact serialization.
- Rendering requires making the embedded target a second editable document/session.
- Async updates require remounting the uncontrolled editor and losing selection/undo.
- The implementation would trust indexed Markdown over the live source file/session.
- Expanded content would enter AI/publishing/export by default.
- Upstream support cannot be expressed as a small generic Meowdown API and released; do not patch or fork inside Reflect.

## Maintenance notes

The embed is a view, never a content copy. Keep the fork rebasing clean by isolating Reflect-specific resolver, places, and visual code in focused components/hooks; existing editor composition should only pass released generic Meowdown props. Future interactive tasks or editing must be separate plans with explicit source-session concurrency semantics. Keep recursion guards canonical-path based so aliases cannot evade them. Reviewers should monitor render/query cost in daily streams: many visible notes can embed the same target, and query deduplication is part of correctness, not an optional optimization.
