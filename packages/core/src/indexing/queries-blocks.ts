import { normalizeWikiTarget, parseWikiAddressCandidates } from '../markdown'
import { db } from './db'
import { decodeBlockBreadcrumbs } from './indexed-note'

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
  | { readonly kind: 'missing'; readonly target: string }
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
  return { kind: 'missing', target: candidates.exactTarget }
}
