import { normalizeWikiTarget, parseWikiAddressCandidates } from '../markdown'
import { sql } from 'kysely'
import { db } from './db'
import { splitSearchTerms } from './search-query'
import { decodeBlockBreadcrumbs } from './indexed-note'

const DEFAULT_BLOCK_SEARCH_LIMIT = 30
const MAX_BLOCK_SEARCH_LIMIT = 100

/** One local block-picker search result. */
export interface BlockSearchResult {
  readonly path: string
  readonly noteTitle: string
  readonly dailyDate: string | null
  readonly ordinal: number
  readonly blockId: string | null
  readonly text: string
  readonly breadcrumbs: readonly string[]
}

export interface BlockSearchOptions {
  readonly currentPath?: string | null
  readonly limit?: number
}

/** One current list-block projection. Markdown remains the durable authority. */
export interface BlockProjection {
  readonly notePath: string
  readonly ordinal: number
  readonly posFrom: number
  readonly posTo: number
  readonly blockId: string | null
  readonly text: string
  readonly markdown: string
  readonly breadcrumbs: readonly string[]
}

/** Result of a case-sensitive block-ID lookup within one note. */
export type BlockLookup =
  | { readonly kind: 'resolved'; readonly block: BlockProjection }
  | { readonly kind: 'missing'; readonly notePath: string; readonly blockId: string }
  | {
      readonly kind: 'ambiguous'
      readonly notePath: string
      readonly blockId: string
      readonly count: number
    }

/** Exact-first resolution result for a note, heading, or durable block address. */
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
  | {
      readonly kind: 'missing'
      readonly target: string
      readonly path?: string
      readonly fragmentKind?: 'block'
      readonly fragmentValue?: string
    }
  | {
      readonly kind: 'ambiguousBlock'
      readonly path: string
      readonly blockId: string
      readonly count: number
    }

function toBlockProjection(row: {
  notePath: string
  ordinal: number
  posFrom: number
  posTo: number
  blockId: string | null
  text: string
  markdown: string
  breadcrumbs: string
}): BlockProjection {
  return {
    ...row,
    breadcrumbs: decodeBlockBreadcrumbs(row.breadcrumbs),
  }
}

/** Search local block text, note titles, and breadcrumb context within a hard bound. */
export async function searchBlocks(
  query: string,
  options: BlockSearchOptions = {},
): Promise<BlockSearchResult[]> {
  const requestedLimit = options.limit ?? DEFAULT_BLOCK_SEARCH_LIMIT
  const limit = Math.min(MAX_BLOCK_SEARCH_LIMIT, Math.max(1, Math.trunc(requestedLimit)))
  const currentPath = options.currentPath ?? ''
  const terms = splitSearchTerms(query)
  const rows =
    terms.length === 0
      ? await db
          .selectFrom('blocks')
          .innerJoin('notes', 'notes.path', 'blocks.notePath')
          .where('notes.kind', '!=', 'template')
          .select([
            'blocks.notePath as path',
            'notes.title as noteTitle',
            'notes.dailyDate',
            'blocks.ordinal',
            'blocks.blockId',
            'blocks.text',
            'blocks.breadcrumbs',
          ])
          .orderBy(sql`CASE WHEN blocks.note_path = ${currentPath} THEN 0 ELSE 1 END`)
          .orderBy('notes.updatedAt', 'desc')
          .orderBy('blocks.ordinal')
          .limit(limit)
          .execute()
      : await db
          .selectFrom('blocksFts')
          .innerJoin('blocks', (join) =>
            join
              .onRef('blocks.notePath', '=', 'blocksFts.notePath')
              .on(sql`blocks.ordinal = CAST(blocks_fts.ordinal AS INTEGER)`),
          )
          .innerJoin('notes', 'notes.path', 'blocks.notePath')
          .where('notes.kind', '!=', 'template')
          .where(sql<boolean>`blocks_fts MATCH ${prefixMatch(terms)}`)
          .select([
            'blocks.notePath as path',
            'notes.title as noteTitle',
            'notes.dailyDate',
            'blocks.ordinal',
            'blocks.blockId',
            'blocks.text',
            'blocks.breadcrumbs',
          ])
          .orderBy(sql`bm25(blocks_fts, 0, 10.0, 3.0, 2.0)`)
          .orderBy(sql`CASE WHEN blocks.note_path = ${currentPath} THEN 0 ELSE 1 END`)
          .orderBy('notes.updatedAt', 'desc')
          .orderBy('blocks.ordinal')
          .limit(limit)
          .execute()

  return rows.map((row) => ({
    ...row,
    breadcrumbs: decodeBlockBreadcrumbs(row.breadcrumbs),
  }))
}

function prefixMatch(terms: readonly string[]): string {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ')
}

/**
 * Look up a note-scoped, case-sensitive block ID. Duplicate IDs are explicit
 * ambiguity rather than an arbitrary first match.
 */
export async function getBlockById(notePath: string, blockId: string): Promise<BlockLookup> {
  const key = await db
    .selectFrom('blockKeys')
    .where('notePath', '=', notePath)
    .where('blockId', '=', blockId)
    .select(['claimCount', 'ordinal'])
    .executeTakeFirst()

  if (key === undefined) {
    return { kind: 'missing', notePath, blockId }
  }
  if (Number(key.claimCount) !== 1 || key.ordinal === null) {
    return { kind: 'ambiguous', notePath, blockId, count: Number(key.claimCount) }
  }

  const row = await db
    .selectFrom('blocks')
    .where('notePath', '=', notePath)
    .where('ordinal', '=', Number(key.ordinal))
    .selectAll()
    .executeTakeFirst()
  return row === undefined
    ? { kind: 'missing', notePath, blockId }
    : { kind: 'resolved', block: toBlockProjection(row) }
}

/**
 * Resolve an indexed wiki address with exact-target-first semantics. A complete
 * note title containing `#` wins before the final segment is interpreted as a
 * heading or block fragment.
 */
export async function resolveWikiAddress(target: string): Promise<ResolvedWikiAddress> {
  const candidates = parseWikiAddressCandidates(target)
  const exact = await db
    .selectFrom('noteKeys')
    .where('key', '=', normalizeWikiTarget(candidates.exactTarget).key)
    .select('notePath')
    .executeTakeFirst()
  if (exact?.notePath) {
    return { kind: 'note', path: exact.notePath }
  }

  if (candidates.fragmented === null) {
    return { kind: 'missing', target: candidates.exactTarget }
  }

  const base = await db
    .selectFrom('noteKeys')
    .where('key', '=', normalizeWikiTarget(candidates.fragmented.noteTarget).key)
    .select('notePath')
    .executeTakeFirst()
  if (!base?.notePath) {
    return { kind: 'missing', target: candidates.exactTarget }
  }

  if (candidates.fragmented.fragment.kind === 'heading') {
    return {
      kind: 'heading',
      path: base.notePath,
      heading: candidates.fragmented.fragment.value,
    }
  }

  const blockId = candidates.fragmented.fragment.id
  const block = await getBlockById(base.notePath, blockId)
  if (block.kind === 'resolved') {
    return {
      kind: 'block',
      path: base.notePath,
      blockId,
      ordinal: block.block.ordinal,
      text: block.block.text,
    }
  }
  if (block.kind === 'ambiguous') {
    return {
      kind: 'ambiguousBlock',
      path: base.notePath,
      blockId,
      count: block.count,
    }
  }
  return {
    kind: 'missing',
    target: candidates.exactTarget,
    path: base.notePath,
    fragmentKind: 'block',
    fragmentValue: blockId,
  }
}
