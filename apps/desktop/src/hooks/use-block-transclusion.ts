import { useQuery } from '@tanstack/react-query'
import { isAppError, parseNote, resolveWikiAddress } from '@reflect/core'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { useGraph } from '@/providers/graph-provider'

const MAX_TRANSCLUSION_DEPTH = 3

export interface ResolvedBlockTransclusion {
  readonly kind: 'resolved'
  readonly path: string
  readonly blockId: string
  readonly noteTitle: string
  readonly text: string
  readonly markdown: string
  readonly breadcrumbs: readonly string[]
  readonly visitedAddresses: ReadonlySet<string>
}

export type BlockTransclusionState =
  | ResolvedBlockTransclusion
  | { readonly kind: 'loading' }
  | { readonly kind: 'missingNote'; readonly target: string }
  | { readonly kind: 'missingBlock'; readonly target: string; readonly path?: string }
  | { readonly kind: 'ambiguousBlock'; readonly target: string; readonly path: string }
  | { readonly kind: 'cycle'; readonly target: string }
  | { readonly kind: 'error'; readonly target: string }

export interface BlockTransclusionContext {
  readonly visitedAddresses?: ReadonlySet<string>
  readonly depth?: number
}

/** Resolve one authored block embed against the index, then revalidate live Markdown authority. */
export async function resolveBlockTransclusion(
  target: string,
  generation: number,
  context: BlockTransclusionContext = {},
): Promise<Exclude<BlockTransclusionState, { kind: 'loading' }>> {
  const depth = context.depth ?? 0
  if (depth >= MAX_TRANSCLUSION_DEPTH) return { kind: 'cycle', target }

  const address = await resolveWikiAddress(target)
  if (address.kind === 'ambiguousBlock') {
    return { kind: 'ambiguousBlock', target, path: address.path }
  }
  if (address.kind === 'missing') {
    return address.fragmentKind === 'block'
      ? { kind: 'missingBlock', target, ...(address.path ? { path: address.path } : {}) }
      : { kind: 'missingNote', target }
  }
  if (address.kind !== 'block') {
    return { kind: 'missingBlock', target, path: address.path }
  }

  const canonicalAddress = `${address.path}#^${address.blockId}`
  if (context.visitedAddresses?.has(canonicalAddress)) return { kind: 'cycle', target }

  let source: string
  try {
    source = await readExistingNoteSource(address.path, generation)
  } catch (cause) {
    return isAppError(cause) && cause.kind === 'notFound'
      ? { kind: 'missingNote', target }
      : { kind: 'error', target }
  }

  try {
    const note = parseNote({ path: address.path, source })
    const matches = note.blocks.filter((block) => block.id === address.blockId)
    if (matches.length !== 1) {
      return matches.length > 1
        ? { kind: 'ambiguousBlock', target, path: address.path }
        : { kind: 'missingBlock', target, path: address.path }
    }
    const block = matches[0]!
    return {
      kind: 'resolved',
      path: address.path,
      blockId: address.blockId,
      noteTitle: note.title,
      text: block.text,
      markdown: block.markdown,
      breadcrumbs: block.breadcrumbs,
      visitedAddresses: new Set([...(context.visitedAddresses ?? []), canonicalAddress]),
    }
  } catch {
    return { kind: 'error', target }
  }
}

/** Live local query for one block transclusion. Watcher invalidation refreshes target edits. */
export function useBlockTransclusion(
  target: string,
  context: BlockTransclusionContext = {},
): BlockTransclusionState {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const visited = [...(context.visitedAddresses ?? [])].sort()
  const query = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      generation,
      'block-transclusion',
      target,
      context.depth ?? 0,
      visited,
    ],
    queryFn: () => {
      if (generation === null) throw new Error('No graph is open.')
      return resolveBlockTransclusion(target, generation, context)
    },
    enabled: generation !== null,
  })
  if (generation === null || query.isPending) return { kind: 'loading' }
  if (query.isError) return { kind: 'error', target }
  return query.data
}
