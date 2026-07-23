# Plan 001: Establish the Markdown block-addressing contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's status row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cedba83c..HEAD -- docs/block-addressing.md packages/core/src/markdown`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. A contract
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `cedba83c`, 2026-07-22

## Why this matters

Reflect cannot safely add block references, backlinks, or transclusion until one parser-owned definition answers three questions: what is a referenceable block, how is its durable ID represented in Markdown, and how is a `[[wiki target]]` separated from an optional heading/block fragment without breaking existing note titles containing `#`. This plan establishes that contract in `@reflect/core` and documents it before any database or UI work. It deliberately keeps Markdown durable and the index rebuildable.

## Current state

- `docs/reflect-v2-product-vision.md:188-194` says one note lives in each Markdown file and frontmatter stays minimal.
- `docs/reflect-v2-indexing-strategy.md:58-60` says Markdown is durable while SQLite is a rebuildable projection.
- `packages/core/src/markdown/model.ts:132-137` currently models a wiki link as a raw target/alias plus source span; it has no fragment model.
- `packages/core/src/markdown/model.ts:212-231` currently models a parsed note with note-wide tags, headings, tasks, and text, but no referenceable blocks.
- `packages/core/src/markdown/extract.ts:376-395` assembles the parsed-note projection and must add blocks without changing existing tag behavior.
- `packages/core/src/markdown/resolve.ts:32-39` trims and folds the entire wiki target. Therefore `[[Project#^abc123]]` is currently looked up as a note literally named `Project#^abc123`.
- `packages/core/src/indexing/block-context.ts:23-27` already treats a list item as a unit of meaning for backlink snippets. Reuse its Lezer list semantics rather than inventing a line-regex-only block model.
- `packages/core/src/markdown/task-breadcrumbs.ts` is the exemplar for walking ancestor `ListItem` nodes and deriving stable display breadcrumbs.
- Public TypeScript APIs require documentation comments, interfaces, strict types, kebab-case files, and colocated tests.

The contract to implement is:

```markdown
- A referenceable bullet with an explicit durable id ^k7m2q9ab
```

```text
[[Project#^k7m2q9ab|Keep Markdown as the source of truth]]  block reference / jump
[[Project#Heading]]                                      heading reference / jump
![[Project#^k7m2q9ab]]                                   block embed / transclusion
```

Rules:

1. The first implementation makes **list items** referenceable, including ordinary bullets, ordered items, square checkboxes, and Reflect round tasks. Paragraphs, headings, tables, and code blocks are not addressable blocks yet.
2. A block marker is one whitespace-delimited `^id` suffix at the end of the list item's **lead physical line**. It is not recognized inside code, a wiki link, or any other parsed inline syntax.
3. User-authored IDs accept 1–64 ASCII letters, digits, and hyphens, must contain at least one letter, and compare case-sensitively. Reflect-generated IDs are eight lowercase Crockford Base32 characters and are unique within the note at mint time.
4. IDs are minted only after an explicit action such as “Copy block reference” or selecting a block in the reference picker; parsing, indexing, and viewing a block must not rewrite the file.
5. The marker is omitted from normal live preview—even when the caret is in the block—as well as block display text, note plain text, FTS text, task text, breadcrumbs, reference labels, and transclusions. It remains literal source Markdown, is visible in explicit raw-source views, and survives round trips.
6. A `#^` suffix is an unambiguous block-fragment candidate and splits at the last `#^`. A plain `#` suffix is a heading-fragment candidate and splits at the last `#`.
7. Existing behavior wins: resolution first tries the entire raw target as an exact note title/alias/date. Only when that full target is missing may it resolve the base note plus fragment. This preserves links to existing notes whose titles contain `#`.
8. Duplicate explicit IDs in one note are represented and diagnosed; no helper silently chooses the first duplicate.
9. Internal block references use the readable note address plus a human alias (`[[Title#^id|Block text]]`). Picker/copy actions sanitize and snapshot that alias from current block text so normal rendering never exposes the ID; explicit user-authored aliases remain untouched. External deep links use the stable note ID/date plus the same `#^id` fragment.
10. Parsing preserves whether an address was authored as a reference (`[[...]]`) or embed (`![[...]]`). Both resolve identically, but embed-place counts and transclusion rendering must not infer syntax later from source text.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Targeted tests | `pnpm test --run packages/core/src/markdown/block-address.test.ts packages/core/src/markdown/blocks.test.ts packages/core/src/markdown/extract.test.ts` | exit 0, all tests pass |
| Core typecheck | `pnpm --filter @reflect/core typecheck` | exit 0, no errors |
| Full checks | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `docs/block-addressing.md` (create)
- `packages/core/src/markdown/block-address.ts` (create)
- `packages/core/src/markdown/block-address.test.ts` (create)
- `packages/core/src/markdown/blocks.ts` (create)
- `packages/core/src/markdown/blocks.test.ts` (create)
- `packages/core/src/markdown/model.ts`
- `packages/core/src/markdown/extract.ts`
- `packages/core/src/markdown/extract.test.ts`
- `packages/core/src/markdown/plain-text.ts` only if marker exclusion requires a shared cut helper
- `packages/core/src/markdown/index.ts`
- `packages/core/src/index.ts`

**Out of scope**:

- SQLite migrations or Rust index writes.
- Changes to Meowdown packages or Reflect's `@meowdown/*` versions.
- Routes, deep links, block-reference UI, backlinks UI, or transclusion rendering.
- Addressable paragraphs/headings and block-level editing/history.
- Automatically adding IDs to every list item.
- Block-level tag occurrences, filtering, or tag UI.

## Git workflow

- Fetch `upstream`, fast-forward pristine `master`, push that mirror to `origin/master`, then branch: `feat/block-addressing-contract`.
- Use conventional commits, for example `feat: define portable block addresses`.
- When complete, push the topic branch only to `origin`. Open a fork-local PR targeting `jasonlong/reflect-open:master`; do not push to or create refs in the upstream repository.
- Do not edit release versions, changelogs, or release-please manifests.

## Steps

### Step 1: Write the durable syntax decision

Create `docs/block-addressing.md`. Include the syntax/rules above, terminology (reference vs embed/transclusion vs occlusion), exact-first note resolution, duplicate-ID behavior, portability rationale for the Obsidian-compatible `#^id` form, why IDs are on-demand, and the rule that IDs are hidden from normal live-preview UI. State explicitly that SQLite rows are projections and that deleting an ID makes inbound references unresolved rather than transferring them to another block.

Document editing semantics for later Meowdown work:

- moving a list item carries its ID;
- splitting a block keeps the ID on the upper/original item and gives the new item no ID;
- copied/pasted content drops the ID, while drag-reordering preserves it;
- deleting/joining away an addressed block is allowed and leaves references unresolved;
- duplicated IDs from external edits/sync are ambiguous and never first-match resolved.

**Verify**: `rg -n "#\^|exact|duplicate|on-demand|transclusion|occlusion" docs/block-addressing.md` → each contract topic has at least one match.

### Step 2: Add pure wiki-address parsing

Create `block-address.ts` with documented interfaces and functions. Use interfaces for object shapes and a discriminated union for fragments:

```ts
export type WikiFragment =
  | { readonly kind: 'heading'; readonly value: string }
  | { readonly kind: 'block'; readonly id: string }

export interface WikiAddressCandidates {
  readonly exactTarget: string
  readonly fragmented: {
    readonly noteTarget: string
    readonly fragment: WikiFragment
  } | null
}
```

Add:

- `parseWikiAddressCandidates(target: string): WikiAddressCandidates`;
- `isBlockId(value: string): boolean`;
- `newBlockId(existingIds?: ReadonlySet<string>): string`.

`parseWikiAddressCandidates` must not itself decide whether the exact or fragmented candidate wins; that requires graph lookup and belongs in Plan 003. It must return a fragment candidate only when both note target and fragment are non-empty and a block ID is valid. For heading fragments, decode nothing here; preserve authored text.

Generate IDs with `crypto.getRandomValues` (or an existing project-approved runtime-neutral primitive) and Crockford's ambiguity-free lowercase alphabet. Retry against `existingIds`; after a bounded number of failed attempts, throw loudly. Do not import UI or Tauri APIs.

Tests must cover block fragments, heading fragments, titles containing `#`, last-separator behavior, whitespace, invalid/all-numeric block IDs, aliases remaining outside this parser, and bounded collision retry via an injected/testable random source if needed.

**Verify**: `pnpm test --run packages/core/src/markdown/block-address.test.ts` → all tests pass.

### Step 3: Extract referenceable list blocks

Create `blocks.ts` and add a documented `ParsedBlock` interface in `model.ts` (or colocated if it stays parser-private; export it publicly either way):

```ts
export interface ParsedBlock extends Span {
  readonly ordinal: number
  readonly kind: 'listItem'
  readonly id: string | null
  readonly markerSpan: Span | null
  readonly leadFrom: number
  readonly leadTo: number
  readonly text: string
  readonly markdown: string
  readonly breadcrumbs: readonly string[]
}
```

All spans must use whole-file UTF-16 offsets, matching existing links/tasks. `from/to` cover the complete list-item subtree. `leadFrom/leadTo` cover its own lead text block. `markdown` is display-ready source for the item subtree with the ID marker removed but list/nesting structure preserved. `ordinal` is document order among all parsed list items, including nested items.

Walk the canonical `parseBody` Lezer tree. Do not infer blocks by splitting lines. Reuse/extract the list-lead and breadcrumb logic from `task-breadcrumbs.ts` or `block-context.ts` without duplicating divergent definitions. Detect the suffix only in the lead line and verify its range is plain text, not inside an excluded syntax node. Keep duplicate IDs as separate block rows.

Add `findDuplicateBlockIds(blocks)` returning each duplicated ID and its block ordinals/spans. Do not throw during `parseNote`; externally edited notes must remain readable.

Tests must cover top-level/nested bullets, ordered items, square/round tasks, collapsed `+` bullets, wrapped lines, child subtrees, CRLF, frontmatter offsets, code spans/fences, literal carets in prose, valid/invalid IDs, and duplicate IDs.

**Verify**: `pnpm test --run packages/core/src/markdown/blocks.test.ts` → all tests pass.

### Step 4: Integrate parsed blocks, preserve link syntax, and remove markers

Extend `ParsedNote` with `blocks: ParsedBlock[]` and populate it from the canonical body parse. Extend `WikiLink` with `syntax: 'reference' | 'embed'`, derived from the Lezer node name while walking—not by rescanning source later. Keep existing `tags: string[]` and tag extraction completely unchanged.

Ensure a block marker does not appear in `ParsedBlock.text`, `ParsedBlock.markdown`, `ParsedNote.text`, task text, or breadcrumbs. Reuse one span-removal helper where multiple derived projections need the same exclusion; do not create independent marker regexes.

Bump `PARSED_NOTE_VERSION` and update its history comment.

**Verify**: `pnpm test --run packages/core/src/markdown/extract.test.ts packages/core/src/markdown/blocks.test.ts` → all tests pass and existing tag assertions are unchanged.

### Step 5: Export the contract and run repository checks

Export all public types/helpers through `packages/core/src/markdown/index.ts` and `packages/core/src/index.ts`. Add public doc comments explaining durability and offset units.

Run the full checks and inspect scope.

**Verify**:

- `pnpm --filter @reflect/core typecheck` → exit 0.
- `pnpm check` → exit 0.
- `git diff --check` → no whitespace errors.
- `git status --short` → only files listed under “In scope” plus `plans/README.md` are modified.

## Test plan

Model tests after `packages/core/src/markdown/extract.test.ts`, `task-breadcrumbs.ts`, and `packages/core/src/indexing/block-context.test.ts`.

Required cases:

- exact and candidate-fragment parsing without graph lookup;
- IDs on ordinary/nested/ordered/task list items;
- ID suffix excluded from every derived display/search field;
- marker-looking text inside code/wiki syntax remains ordinary text;
- whole-file offsets with and without frontmatter/CRLF;
- duplicate IDs are reported, not silently resolved;
- reference/embed syntax is preserved while existing wiki target/alias behavior remains compatible;
- existing note-wide tag extraction remains byte-for-byte behaviorally unchanged.

## Done criteria

- [ ] `docs/block-addressing.md` pins syntax and editing semantics.
- [ ] `ParsedNote` exposes ordered blocks with whole-file offsets.
- [ ] Existing note-wide tag behavior is unchanged.
- [ ] Block ID markers do not appear in normal live preview, reference labels, plain text, task labels, breadcrumbs, or display Markdown.
- [ ] Parsed wiki links distinguish references from embeds without changing target/alias semantics.
- [ ] Duplicate IDs remain readable and diagnosable.
- [ ] Targeted tests, `pnpm --filter @reflect/core typecheck`, and `pnpm check` pass.
- [ ] No SQLite, Rust, route, UI, or dependency files changed.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Meowdown's canonical Lezer tree does not expose list-item/lead-text ranges consistently enough to implement this without line-only parsing.
- Removing the marker from derived text requires changing Meowdown's serializer in this plan.
- Existing tests prove a valid note title/alias containing `#` cannot coexist with the exact-first candidate model.
- Runtime-neutral secure randomness is unavailable in `@reflect/core`; do not substitute `Math.random`.
- A required behavior would auto-write IDs during parse/indexing.

## Maintenance notes

The syntax in this plan becomes a user-visible storage contract. Keep upstreamability high: add focused parser/model helpers and fixtures; do not reformat or reorganize unrelated Markdown extraction code. Reviewers should scrutinize compatibility with external Markdown tools, exact-first resolution, marker exclusion, and duplicate handling. Future paragraph/heading addressability must extend `ParsedBlock.kind` rather than weakening list-item invariants. The later index must store every block occurrence even when `id` is null; only explicit IDs are durable addresses.
