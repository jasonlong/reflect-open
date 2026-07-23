import { useEffect, useRef } from 'react'
import { dailyPath } from '@reflect/core'
import type { NoteEditorHandle } from '@/editor/note-editor'
import { startOperation } from '@/lib/operations'
import type { NoteFragment, Route } from '@/routing/route'
import { useRouter } from '@/routing/router'

interface NoteFragmentRevealOptions {
  readonly path: string
  readonly ready: boolean
  readonly editor: NoteEditorHandle | null
}

function addressedNote(route: Route): { path: string; fragment: NoteFragment } | null {
  if (route.kind === 'note' && route.fragment != null) {
    return { path: route.path, fragment: route.fragment }
  }
  if (route.kind === 'daily' && route.fragment != null) {
    return { path: dailyPath(route.date), fragment: route.fragment }
  }
  return null
}

/** Reveal one route fragment once its exact note editor is ready and mounted. */
export function useNoteFragmentReveal({
  path,
  ready,
  editor,
}: NoteFragmentRevealOptions): void {
  const { route, entryId, arrivalSeq } = useRouter()
  const consumedArrival = useRef<string | null>(null)

  useEffect(() => {
    const addressed = addressedNote(route)
    if (!ready || editor === null || addressed === null || addressed.path !== path) {
      return
    }
    const arrival = `${entryId}:${arrivalSeq}`
    if (consumedArrival.current === arrival) {
      return
    }
    consumedArrival.current = arrival

    const fragment = addressed.fragment
    const revealed =
      fragment.kind === 'heading'
        ? editor.revealHeading(fragment.value)
        : fragment.kind === 'block'
          ? editor.revealBlock({ id: fragment.id })
          : editor.revealBlock({
              ordinal: fragment.ordinal,
              expectedText: fragment.expectedText,
            })
    if (!revealed) {
      startOperation('Opening link').warn(
        fragment.kind === 'heading'
          ? 'That heading is no longer available.'
          : 'That block is no longer available.',
      )
    }
  }, [arrivalSeq, editor, entryId, path, ready, route])
}
