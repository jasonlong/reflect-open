import { useQuery } from '@tanstack/react-query'
import {
  getSuggestedBacklinks,
  hasBridge,
  isDaily,
  type SuggestedBacklink,
} from '@reflect/core'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'

const SUGGESTED_BACKLINK_LIMIT = 6

/** Stable key for one note's suggested-backlinks query. */
export function suggestedBacklinksQueryKey(
  graphRoot: string | undefined,
  path: string,
): readonly [string, string | undefined, string, string] {
  return [INDEX_QUERY_SCOPE, graphRoot, 'suggested-backlinks', path]
}

/**
 * Other notes with a live, unlinked mention of this note's title or aliases.
 * Daily notes are excluded: plain ISO dates are common prose and produce noisy
 * suggestions, while their explicit incoming links already live below the day.
 */
export function useSuggestedBacklinks(path: string): SuggestedBacklink[] {
  const { graph } = useGraph()
  const enabled = hasBridge() && graph !== null && !isDaily(path)
  const { data } = useQuery({
    queryKey: suggestedBacklinksQueryKey(graph?.root, path),
    queryFn: () => getSuggestedBacklinks(path, SUGGESTED_BACKLINK_LIMIT),
    enabled,
  })
  return enabled ? (data ?? []) : []
}
