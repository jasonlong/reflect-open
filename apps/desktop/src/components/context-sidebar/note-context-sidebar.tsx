import type { ReactElement } from 'react'
import { NoteActionsSection } from './note-actions-section'
import { PublishedUrlSection } from './published-url-section'
import { SimilarNotesSection } from './similar-notes-section'
import { SuggestedBacklinksSection } from './suggested-backlinks-section'

interface NoteContextSidebarProps {
  /** Graph-relative path of the open note the sidebar describes. */
  path: string
}

/**
 * An ordinary note's contextual sidebar: note actions, unlinked textual
 * mentions that can become backlinks, then semantic neighbors. Confirmed
 * inbound links live under the note itself (the incoming-backlinks panel).
 * Rendered in the AppShell's right region on `note` routes.
 */
export function NoteContextSidebar({ path }: NoteContextSidebarProps): ReactElement {
  return (
    <div className="flex flex-col py-2 text-text">
      <div className="my-4 space-y-4 pb-4">
        <NoteActionsSection path={path} showTrash />
        <PublishedUrlSection path={path} />
        <SuggestedBacklinksSection path={path} />
        <SimilarNotesSection path={path} />
      </div>
    </div>
  )
}
