import { describe, expect, it } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { NoteEditorHandle } from './note-editor'
import type { ReactNode } from 'react'
import { BlockPickerProvider, useBlockPicker } from '@/providers/block-picker-provider'
import { useBlockSlashItems } from './use-block-slash-items'

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return <BlockPickerProvider>{children}</BlockPickerProvider>
}

describe('useBlockSlashItems', () => {
  it('opens the shared reference picker only for a live editor', async () => {
    const editor: NoteEditorHandle = {
      getMarkdown: () => '', setMarkdown: () => {}, insertMarkdown: () => {},
      insertBlockEmbed: () => false, focus: () => {},
      setSelection: () => {}, getSelectedText: () => '', openSelectionMenu: () => {},
      startPendingReplacement: () => false, appendPendingReplacementText: () => {},
      acceptPendingReplacement: () => {}, discardPendingReplacement: () => {},
      getActiveBlock: () => null, setActiveBlockId: () => false, setBlockId: () => false,
      revealHeading: () => false, revealBlock: () => false, revealWikiEmbed: () => false,
      refreshMarkdownRendering: () => {},
    }
    const { result, act } = await renderHook(() => {
      const picker = useBlockPicker()
      return { picker, search: useBlockSlashItems(() => editor) }
    }, { wrapper: Wrapper })
    const [item, embed] = await result.current.search('ref')
    expect(item?.label).toBe('Reference block')
    expect(embed?.label).toBe('Embed block')
    await act(() => item?.onSelect())
    expect(result.current.picker.open).toBe(true)
    expect(result.current.picker.intent).toBe('reference')

    await act(() => embed?.onSelect())
    expect(result.current.picker.intent).toBe('embed')
    expect(result.current.picker.replaceEmptyBlock).toBe(true)
  })

  it('does nothing after the editor disappears', async () => {
    const { result, act } = await renderHook(() => useBlockSlashItems(() => null), {
      wrapper: Wrapper,
    })
    const [item] = await result.current('ref')
    await act(() => item?.onSelect())
    expect(item?.label).toBe('Reference block')
  })
})
