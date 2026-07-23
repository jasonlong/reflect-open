import { useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { NoteEditorHandle } from '@/editor/note-editor'
import type { CommandContext } from '@/lib/commands/types'
import { BlockPickerProvider, useBlockPicker } from '@/providers/block-picker-provider'
import { BlockPicker } from './block-picker'

const searchBlocks = vi.hoisted(() => vi.fn())
const ensureBlockAddress = vi.hoisted(() => vi.fn())
const insertMarkdown = vi.hoisted(() => vi.fn())
const focus = vi.hoisted(() => vi.fn())
const insertBlockEmbed = vi.hoisted(() => vi.fn())
let pickerIntent: 'reference' | 'embed' = 'reference'

const editor: NoteEditorHandle = {
  getMarkdown: () => '', setMarkdown: () => {}, insertMarkdown, insertBlockEmbed, focus,
  setSelection: () => {}, getSelectedText: () => '', openSelectionMenu: () => {},
  startPendingReplacement: () => false, appendPendingReplacementText: () => {},
  acceptPendingReplacement: () => {}, discardPendingReplacement: () => {},
  getActiveBlock: () => null, setActiveBlockId: () => false, setBlockId: () => false,
  revealHeading: () => false, revealBlock: () => false, revealWikiEmbed: () => false,
  refreshMarkdownRendering: () => {},
}

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  searchBlocks,
}))
vi.mock('@/editor/editor-handle-registry', () => ({ noteEditorHandleFor: () => editor }))
vi.mock('@/lib/note-block-reference', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/note-block-reference')>()),
  ensureBlockAddress,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 7 } }),
}))

const context: CommandContext = {
  navigate: () => {}, route: () => ({ kind: 'note', path: 'notes/source.md' }),
  notePath: () => 'notes/source.md', back: () => {}, forward: () => {},
  clearScrollState: () => {}, toggleTheme: () => {}, toggleSidebar: () => {},
  newChat: () => {}, switchGraph: () => {}, toggleAudioMemo: () => {},
  generation: () => 7, openPalette: () => {}, openShortcuts: () => {},
  openTemplatePicker: () => {}, openTemplateCreate: () => {}, enableSemanticSearch: () => {},
}

function OpenPicker(): null {
  const { openBlockPicker } = useBlockPicker()
  useEffect(() => openBlockPicker(pickerIntent), [openBlockPicker])
  return null
}

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <BlockPickerProvider>
        <OpenPicker />
        {children}
      </BlockPickerProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  searchBlocks.mockReset().mockResolvedValue([
    {
      path: 'notes/target.md', noteTitle: 'Target', dailyDate: null, ordinal: 2,
      blockId: null, text: 'Keep Markdown', breadcrumbs: ['Architecture', 'Decision'],
    },
  ])
  ensureBlockAddress.mockReset().mockResolvedValue({
    id: 'alpha', noteAddress: 'Target', blockText: 'Keep Markdown',
  })
  pickerIntent = 'reference'
  insertMarkdown.mockReset()
  insertBlockEmbed.mockReset().mockReturnValue(true)
  focus.mockReset()
})

describe('BlockPicker', () => {
  it('searches with context and inserts only after stale-safe assignment', async () => {
    await render(<BlockPicker context={context} />, { wrapper: Wrapper })

    await expect.element(page.getByText('Keep Markdown')).toBeVisible()
    await expect.element(page.getByText('Target · Architecture · Decision')).toBeVisible()
    await page.getByText('Keep Markdown').click()

    await vi.waitFor(() => expect(ensureBlockAddress).toHaveBeenCalledWith({
      notePath: 'notes/target.md',
      locator: { ordinal: 2, expectedText: 'Keep Markdown' },
      indexedBlockId: null,
      generation: 7,
    }))
    expect(insertMarkdown).toHaveBeenCalledWith('[[Target#^alpha|Keep Markdown]]')
    expect(focus).toHaveBeenCalled()
  })

  it('inserts a standalone embed through the editor operation', async () => {
    pickerIntent = 'embed'
    await render(<BlockPicker context={context} />, { wrapper: Wrapper })
    await page.getByText('Keep Markdown').click()
    await vi.waitFor(() => expect(insertBlockEmbed).toHaveBeenCalledWith(
      '![[Target#^alpha]]',
      false,
    ))
    expect(insertMarkdown).not.toHaveBeenCalled()
  })

  it('cancels without assigning an ID', async () => {
    await render(<BlockPicker context={context} />, { wrapper: Wrapper })
    await expect.element(page.getByText('Keep Markdown')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(ensureBlockAddress).not.toHaveBeenCalled()
    expect(insertMarkdown).not.toHaveBeenCalled()
  })
})
