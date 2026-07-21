import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { errorMessage, type SuggestedBacklink } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import {
  suggestedBacklinksQueryKey,
  useSuggestedBacklinks,
} from '@/hooks/use-suggested-backlinks'
import { acceptSuggestedBacklink } from '@/lib/suggested-backlink'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { SidebarSection } from './sidebar-section'

interface SuggestedBacklinksSectionProps {
  /** Graph-relative path of the note whose aliases should be found in prose. */
  path: string
}

/**
 * Quiet, local backlink suggestions: other notes that mention this note's
 * title or aliases in plain prose but do not link it yet. The source title
 * navigates for review; the link button accepts the exact displayed mention.
 * Empty and failed queries stay hidden because this is optional context.
 */
export function SuggestedBacklinksSection({
  path,
}: SuggestedBacklinksSectionProps): ReactElement | null {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const navigateNoteLink = useNoteLinkNavigation(path)
  const suggestions = useSuggestedBacklinks(path)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = graph?.generation ?? null

  if (suggestions.length === 0 || generation === null) {
    return null
  }

  async function accept(
    suggestion: SuggestedBacklink,
    activeGeneration: number,
  ): Promise<void> {
    setPendingPath(suggestion.sourcePath)
    setError(null)
    try {
      await acceptSuggestedBacklink(suggestion, activeGeneration)
      queryClient.setQueryData<SuggestedBacklink[]>(
        suggestedBacklinksQueryKey(graph?.root, path),
        (current) => current?.filter((item) => item.sourcePath !== suggestion.sourcePath),
      )
    } catch (cause) {
      setError(errorMessage(cause))
      await queryClient.invalidateQueries({
        queryKey: suggestedBacklinksQueryKey(graph?.root, path),
      })
    } finally {
      setPendingPath(null)
    }
  }

  return (
    <SidebarSection storageKey="suggested-backlinks" title="Suggested backlinks">
      <ul className="space-y-1">
        {suggestions.map((suggestion) => {
          const isPending = pendingPath === suggestion.sourcePath
          return (
            <li
              key={`${suggestion.sourcePath}:${suggestion.from}`}
              className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-surface-hover"
            >
              <button
                type="button"
                onClick={(event) =>
                  navigateNoteLink(routeForPath(suggestion.sourcePath), event)
                }
                className="min-w-0 flex-1 px-2 text-left"
              >
                <span className="block truncate text-xs font-medium text-text-secondary group-hover:text-text">
                  {suggestion.sourceTitle}
                </span>
                <span className="line-clamp-2 block text-2xs leading-4 text-text-muted">
                  {suggestion.snippet}
                </span>
              </button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={pendingPath !== null}
                aria-label={`Add backlink from ${suggestion.sourceTitle}`}
                title={`Link “${suggestion.text}” to this note`}
                onClick={() => void accept(suggestion, generation)}
              >
                <Link2 aria-hidden className={isPending ? 'animate-pulse' : undefined} />
              </Button>
            </li>
          )
        })}
      </ul>
      {error !== null ? (
        <p role="alert" className="px-3 pt-1 text-2xs text-red-500">
          {error}
        </p>
      ) : null}
    </SidebarSection>
  )
}
