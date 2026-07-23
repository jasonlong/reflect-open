# Plan 003: Index blocks and resolve wiki-link fragments

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before proceeding. This plan deliberately ends at the tested core/index contract; do not add routes or UI here.
>
> **Drift check (run first)**:
> `git diff --stat cedba83c..HEAD -- crates/index-schema apps/desktop/src-tauri/src/db packages/db/src packages/core/src/indexing packages/core/src/markdown apps/desktop/src/dev`
>
> Plans 001 and 002 must be DONE. Confirm `docs/block-addressing.md`, `ParsedNote.blocks`, and Plan 001's wiki-address candidate parser exist.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-establish-block-addressing-contract.md`
- **Category**: direction
- **Planned at**: commit `cedba83c`, 2026-07-22

## Why this matters

Navigation and transclusion need one authoritative, rebuildable mapping from Markdown block IDs and wiki-link fragments to note/block targets. This plan adds that projection, implements exact-full-target-before-fragment resolution, and makes note-title rewrites preserve fragments. It contains no user-facing UI so schema/resolution invariants can be reviewed independently.

## Current state

- `crates/index-schema/migrations/0001_initial.sql:26-36` stores full raw link target/key/alias and positions.
- `crates/index-schema/migrations/0018_note_key_precedence.sql` defines `note_keys` as a one-winner-per-key map with `claim_count`, preserving daily → title → alias precedence.
- `packages/core/src/indexing/indexed-note.ts:77-86,236-250` folds the whole link target into `targetKey`.
- `apps/desktop/src-tauri/src/db/write.rs:19-100` mirrors the zod payload in Rust; `apply_note` replaces all child projections transactionally.
- `apps/desktop/src-tauri/src/db/write.rs:231-280` explicitly moves every child table during note rename.
- `packages/db/src/schema.gen.ts` is generated through `pnpm --filter @reflect/db db:codegen` and must not be hand-edited.
- `packages/core/src/markdown/edit.ts:297-310` rewrites only whole-target matches and would miss `[[Old#^id]]`.
- `packages/core/src/indexing/rename.ts` queries sources by the old full folded target and preserves collision guards.
- Plan 001 defines list blocks, IDs, and candidate fragment parsing. Exact graph resolution remains to be implemented here.

Required resolution result:

```ts
export type ResolvedWikiAddress =
  | { readonly kind: 'note'; readonly path: string }
  | { readonly kind: 'heading'; readonly path: string; readonly heading: string }
  | {
      readonly kind: 'block'
      readonly path: string
      readonly blockId: string
      readonly ordinal: number
      readonly text: string
    }
  | { readonly kind: 'missing'; readonly target: string }
  | {
      readonly kind: 'ambiguousBlock'
      readonly path: string
      readonly blockId: string
      readonly count: number
    }
```

Resolution rules:

1. Resolve the full authored target through existing date/title/alias precedence.
2. Only on a full-target miss, resolve Plan 001's base + fragment candidate.
3. A heading needs only a resolved base note; the live editor validates whether it exists.
4. A block requires exactly one ID claim in the resolved note.
5. Missing/duplicate fragments never create a note or first-row resolve.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| DB codegen | `pnpm --filter @reflect/db db:codegen` | exit 0; generated schema updated |
| Core tests | `pnpm test --run packages/core/src/indexing/indexed-note.test.ts packages/core/src/indexing/resolve-target.test.ts packages/core/src/indexing/rename.test.ts packages/core/src/indexing/parity.test.ts packages/core/src/indexing/pipeline.test.ts` | all pass |
| Stage sidecars | `pnpm --filter @reflect/desktop sidecar` | exit 0 |
| Rust schema | `cargo test -p reflect-index-schema` | exit 0 |
| Rust DB | `cargo test -p reflect-open db::tests` | exit 0 |
| Full checks | `pnpm check` | exit 0 |

## Scope

**In scope**:

- Next append-only migration under `crates/index-schema/migrations/` (expected `0019_blocks_and_link_fragments.sql` if no drift)
- `crates/index-schema/src/lib.rs`
- `apps/desktop/src-tauri/src/db/write.rs`, `db/tests.rs`
- `packages/db/src/schema.gen.ts` via codegen
- `packages/core/src/indexing/indexed-note.ts` and tests
- a focused `packages/core/src/indexing/queries-blocks.ts`/resolver module and tests
- `packages/core/src/indexing/queries-backlinks.ts` only for returned fragment fields; UI grouping waits for Plan 004
- `packages/core/src/indexing/index.ts`
- index flow/dev DB/parity fixtures required by schema/payload changes
- `packages/core/src/markdown/edit.ts` and tests
- `packages/core/src/indexing/rename.ts` and tests

**Out of scope**:

- Routes, deep links, editor reveal, commands, clipboard, or React UI.
- Block-level tag occurrence schema or UI.
- Block picker/reference insertion UX (Plan 005).
- Rendering wiki embeds (Plan 006).
- Durable block state outside Markdown.
- Automatic duplicate-ID repair.

## Git workflow

- Rebase on current `upstream/master` immediately before choosing the migration number; push the topic branch only to `origin`.
- Branch: `feat/index-block-references`.
- Suggested commits: migration/Rust payload; core resolution; rename preservation.
- PR title: `feat: index addressable note blocks`.
- Open a fork-local ready-for-review PR targeting `jasonlong/reflect-open:master`; never push to the upstream remote.

## Steps

### Step 1: Add rebuildable block and link-fragment schema

Append a migration; never edit shipped migrations. Expected shape:

```sql
CREATE TABLE blocks (
  note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  pos_from INTEGER NOT NULL,
  pos_to INTEGER NOT NULL,
  block_id TEXT,
  text TEXT NOT NULL,
  markdown TEXT NOT NULL,
  breadcrumbs TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (note_path, ordinal)
);
CREATE INDEX blocks_note_id ON blocks(note_path, block_id) WHERE block_id IS NOT NULL;
CREATE INDEX blocks_path_pos ON blocks(note_path, pos_from);

CREATE VIRTUAL TABLE blocks_fts USING fts5(
  note_path UNINDEXED,
  ordinal UNINDEXED,
  text,
  context,
  note_title
);

ALTER TABLE links ADD COLUMN target_base_key TEXT;
ALTER TABLE links ADD COLUMN fragment_kind TEXT
  CHECK (fragment_kind IN ('heading', 'block') OR fragment_kind IS NULL);
ALTER TABLE links ADD COLUMN fragment_value TEXT;
ALTER TABLE links ADD COLUMN wiki_syntax TEXT
  CHECK (wiki_syntax IN ('reference', 'embed') OR wiki_syntax IS NULL);
```

Do not add a unique `(note_path, block_id)` constraint. Create `block_keys`, grouped by note path and ID, exposing `claim_count` and unique ordinal/position only when one row claims the ID.

`blocks_fts` supports Plan 005's local picker. `context` is plain breadcrumb text, not JSON; `note_title` allows users to narrow by a remembered source note. It indexes every block, including blocks without IDs, but never the source `^id` marker. Treat it like existing `search_fts`: explicit apply/move/remove/clear lifecycle, no foreign-key assumptions.

Rebuild `backlinks` with exact-first semantics:

- first branch joins full `links.target_key` to `note_keys` and exposes no fragment;
- second branch runs only where no full-key winner exists, joins `target_base_key`, and exposes fragment fields;
- preserve migration 0018's template exclusion.

Create `block_backlinks` as resolved block fragments joined to `block_keys` with `claim_count = 1`. Missing/duplicate block targets must not disappear from general `backlinks`; they remain note backlinks with unavailable fragment metadata. Also expose a narrow `block_embed_places` view/query source filtered to `wiki_syntax = 'embed'`; include each source note's document-order embed ordinal (derived from `pos_from`) for Plan 006's verified in-window reveal. Plan 006 uses it for “Appears in N places” without confusing ordinary references with rendered instances.

Bump `LATEST_SCHEMA_VERSION`. Add indexes justified by the exact query joins. Update schema migration tests from v18 and fresh DB tests.

**Verify**: `cargo test -p reflect-index-schema` passes cases for exact title containing `#`, heading candidate, valid block, missing block, duplicate block, reference-vs-embed place filtering, and template exclusion.

### Step 2: Extend the TS→Rust projection

Add zod-backed `IndexedBlock` and fragment fields to `IndexedLink`:

- `targetKey`: full authored target's folded key;
- `targetBaseKey`: candidate base folded key or null;
- `fragmentKind/fragmentValue`: candidate or null;
- `wikiSyntax`: Plan 001's `reference | embed` for wiki nodes, null for Markdown links.

Populate blocks from `ParsedNote.blocks`, including ordinal, whole-file ranges, display text/Markdown, optional ID, and encoded breadcrumbs. Mirror every field in Rust, insert blocks and extended links in `apply_note`, and move blocks in `move_note`. In the same transaction, replace that note's `blocks_fts` rows with display text, a plain breadcrumb context, and the current note title. Explicitly update/delete `blocks_fts` in move, remove, and clear paths, following `search_fts`.

Bump `PROJECTION_VERSION` so unchanged notes backfill. Update dev/browser DB, flow harness, schema/payload drift tests, clear/remove/move tests, and codegen.

**Verify**:

- indexed-note tests pin full vs base keys and reference-vs-embed syntax;
- Rust apply/move/remove/clear tests include `blocks` and `blocks_fts` rows;
- `pnpm --filter @reflect/db db:codegen` exits 0;
- parity/pipeline tests pass.

### Step 3: Add exact-first core resolution

Implement one public resolver over `note_keys` and `block_keys`. Reuse existing ambiguity policy for notes; do not duplicate title/alias/date SQL in a second ad hoc query. Return the discriminated result above.

Behavior examples:

- if a note literally named `Project#Plan` exists, `[[Project#Plan]]` resolves to that note;
- otherwise, if `Project` exists, the same source is a heading fragment;
- `[[Project#^abc]]` resolves only when Project exists and exactly one `abc` block exists;
- duplicate `abc` returns `ambiguousBlock` with count;
- if neither full nor base resolves, return `missing` for the full authored target;
- date/alias precedence remains identical to ordinary wiki links.

Add a query to retrieve a unique current block projection by path/ID for later navigation/embed preflight. Treat the Markdown source as authority in Plan 006; this query is a fast projection only.

**Verify**: focused tests cover exact-first, all note tiers, case-sensitive block IDs, duplicates, missing targets, templates, and private local notes.

### Step 4: Preserve fragments during note renames

Refactor `renameWikiLink` to compare the exact target and candidate base correctly. Rewrite only the base note portion and retain fragment and alias bytes:

```text
[[Old#^abc|decision]] → [[New#^abc|decision]]
[[Old#Plan]]          → [[New#Plan]]
```

A literal exact note title `Old#Plan` must not be treated as fragmented when it resolves exactly. Since the pure source edit helper lacks graph lookup, pass it an explicit rewrite mode/candidate selected by the orchestrator rather than making it guess.

Update `rewriteLinksForTitleChange` source discovery to include fragment-base rows while preserving collision/destination guards and deterministic progress. Wiki embeds use the same rewrite path.

**Verify**: rename tests cover aliases, embeds, block/heading fragments, rich titles, literal `#` titles, self-links, and destination collisions.

### Step 5: Expose backlink fragment metadata without changing UI

Extend `Backlink`/`BacklinkContext` query types with resolved `fragmentKind`, `fragmentValue`, target block ID/text where uniquely available, and an availability/ambiguity state. Keep pagination, one-read/one-parse-per-source, and snippet dedupe behavior unchanged. Include target fragment in dedupe keys so one source snippet linking two target blocks remains two logical references.

Do not alter React components in this plan; tests should characterize the data Plan 004 will render.

**Verify**: query tests cover valid/missing/duplicate block targets, heading refs, same snippet to two blocks, ordinary links, and embed-only place filtering.

### Step 6: Run repository gates

Run targeted tests, codegen, Rust tests, `pnpm check`, `git diff --check`, and scope inspection.

## Test plan

Use migration tests, Rust DB move/apply tests, `indexed-note.test.ts`, `resolve-target.test.ts`, `rename.test.ts`, and `queries-backlinks` tests.

Required coverage:

- v18 → new migration retains old data;
- rebuild/move/delete lifecycle for block and block-FTS rows;
- exact target beats fragment candidate;
- daily/title/alias precedence;
- duplicate block IDs never first-match;
- rename preserves fragment/alias source;
- backlink data retains unavailable fragments;
- embed-place data excludes ordinary block references.

## Done criteria

- [ ] Every parsed list block has rebuildable `blocks` and local-search `blocks_fts` rows.
- [ ] Link rows retain full target, optional fragment candidate, and reference/embed syntax.
- [ ] Exact-first resolution is shared and tested.
- [ ] Duplicate block IDs are ambiguous, never arbitrarily resolved.
- [ ] Note rename preserves heading/block fragments.
- [ ] Backlink queries expose target-fragment metadata.
- [ ] Targeted TS/Rust tests and `pnpm check` pass.
- [ ] No routing/editor/UI files changed.
- [ ] `plans/README.md` status is updated.

## STOP conditions

Stop and report if:

- Plan 001's parser contract is absent or materially changed.
- Exact-first resolution cannot be made identical in SQLite-backed queries and rename orchestration.
- Duplicate IDs would make indexing fail or require a unique constraint.
- A schema change would make `blocks` durable/non-rebuildable.
- Renames cannot preserve fragments without guessing resolution inside a pure text helper.

## Maintenance notes

Keep this upstream-friendly by using one append-only migration, one projection payload extension, and focused query modules; do not replace existing note/link tables or create a fork-only database path. After this plan, consumers must stop assuming `targetKey` is always the note key; it is the full exact candidate. New consumers should call the shared resolver or query the resolved views. Every future note-row move test must include `blocks`. If block syntax expands beyond list items, use a projection-version bump rather than changing old migration semantics.
