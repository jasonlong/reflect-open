import { useCallback } from 'react'
import type { SlashMenuItem, SlashMenuSearchHandler } from '@meowdown/react'
import { useBlockPicker } from '@/providers/block-picker-provider'
import type { NoteEditorHandle } from './note-editor'

/** The `/Reference block` entry point into the shared block picker. */
export function useBlockSlashItems(
  getEditor: () => NoteEditorHandle | null,
): SlashMenuSearchHandler {
  const { openBlockPicker } = useBlockPicker()
  return useCallback(
    async (_query: string): Promise<SlashMenuItem[]> => [
      {
        id: 'reference-block',
        label: 'Reference block',
        keywords: ['block', 'reference', 'link', 'bullet'],
        onSelect: () => {
          if (getEditor() !== null) {
            openBlockPicker('reference')
          }
        },
      },
    ],
    [getEditor, openBlockPicker],
  )
}
