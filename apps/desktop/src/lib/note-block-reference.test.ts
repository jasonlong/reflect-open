import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '@reflect/core'
import type { NoteSession } from '@/editor/note-session'
import {
  registerNoteEditorHandle,
  unregisterNoteEditorHandle,
} from '@/editor/editor-handle-registry'
import { registerOpenDocument } from '@/editor/open-documents'
import type { NoteEditorBlock, NoteEditorHandle } from '@/editor/note-editor'
import type { CommandContext } from '@/lib/commands/types'
import {
  blockReferenceLabel,
  ensureActiveBlockAddress,
  ensureBlockAddress,
  formatBlockAddressEmbed,
  formatBlockAddressReference,
  formatBlockReference,
  runCopyBlockEmbed,
  runCopyBlockReference,
} from './note-block-reference'

const cleanups: Array<() => void> = []

function context(path = 'notes/project.md', generation = 7): CommandContext {
  return {
    navigate: () => {},
    route: () => ({ kind: 'note', path }),
    notePath: () => path,
    back: () => {},
    forward: () => {},
    clearScrollState: () => {},
    toggleTheme: () => {},
    toggleSidebar: () => {},
    newChat: () => {},
    switchGraph: () => {},
    toggleAudioMemo: () => {},
    generation: () => generation,
    openPalette: () => {},
    openShortcuts: () => {},
    openTemplatePicker: () => {},
    openTemplateCreate: () => {},
    enableSemanticSearch: () => {},
  }
}

function installEditor(options?: {
  path?: string
  markdown?: string
  active?: NoteEditorBlock | null
  writable?: boolean
  flushFails?: boolean
}): {
  editor: NoteEditorHandle
  session: NoteSession
  flush: ReturnType<typeof vi.fn<() => Promise<void>>>
  setActiveBlockId: ReturnType<typeof vi.fn<(id: string) => boolean>>
} {
  const path = options?.path ?? 'notes/project.md'
  let markdown = options?.markdown ?? '# Project\n\n- Keep Markdown\n'
  let active: NoteEditorBlock | null =
    options !== undefined && 'active' in options
      ? options.active ?? null
      : {
          kind: 'listItem',
          id: null,
          ordinal: 0,
          text: 'Keep Markdown',
        }
  let dirty = false
  const setActiveBlockId = vi.fn((id: string) => {
    if (active === null) {
      return false
    }
    active = { ...active, id }
    markdown = markdown.replace(/(Keep Markdown)(?: \^[A-Za-z0-9-]+)?/, `$1 ^${id}`)
    dirty = true
    return true
  })
  const flush = vi.fn(async () => {
    if (options?.flushFails !== true) {
      dirty = false
    }
  })
  const editor: NoteEditorHandle = {
    getMarkdown: () => markdown,
    setMarkdown: () => {},
    insertMarkdown: () => {},
    insertBlockEmbed: () => false,
    focus: () => {},
    setSelection: () => {},
    getSelectedText: () => '',
    openSelectionMenu: () => {},
    startPendingReplacement: () => false,
    appendPendingReplacementText: () => {},
    acceptPendingReplacement: () => {},
    discardPendingReplacement: () => {},
    getActiveBlock: () => active,
    setActiveBlockId,
    setBlockId: (_locator, id) => setActiveBlockId(id),
    revealHeading: () => false,
    revealBlock: () => false,
    revealWikiEmbed: () => false,
    refreshMarkdownRendering: () => {},
  }
  const session: NoteSession = {
    path,
    retarget: () => {},
    load: () => {},
    editorChanged: () => {},
    externalChanged: () => {},
    flush,
    keepMine: () => {},
    loadTheirs: () => {},
    content: () => markdown,
    liveContent: () => markdown,
    isDirty: () => dirty,
    canCommitEditorChange: () => options?.writable !== false,
    updateFrontmatter: () => true,
    commitFrontmatter: async () => true,
    commitTaskToggle: async () => false,
    commitTaskEdit: async () => false,
    commitTaskRemove: async () => false,
    commitTaskToBullet: async () => false,
    commitBodyAppend: async () => false,
    dispose: () => {},
    discard: () => {},
  }
  registerNoteEditorHandle(path, editor)
  cleanups.push(() => unregisterNoteEditorHandle(path, editor))
  cleanups.push(registerOpenDocument({ session }))
  return { editor, session, flush, setActiveBlockId }
}

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.()
  }
  Reflect.deleteProperty(navigator, 'clipboard')
  setBridge(null)
  vi.restoreAllMocks()
})

describe('block reference formatting', () => {
  it('sanitizes delimiters, falls back for empty text, and truncates by code point', () => {
    expect(blockReferenceLabel('  Decision | [[keep]]\nMarkdown  ', 'Project')).toBe(
      'Decision keep Markdown',
    )
    expect(blockReferenceLabel('   ', 'Project')).toBe('Block in Project')
    const long = blockReferenceLabel('🙂'.repeat(100), 'Project')
    expect(Array.from(long)).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('formats a readable portable reference without leaking the ID into its label', () => {
    const reference = formatBlockReference({
      path: 'notes/project.md',
      id: 'secret-id',
      noteTitle: 'Project',
      blockText: 'Keep Markdown',
      generation: 7,
    })
    expect(reference).toBe('[[Project#^secret-id|Keep Markdown]]')
    expect(reference.split('|')[1]).not.toContain('secret-id')
  })
})

describe('ensureActiveBlockAddress', () => {
  it('mints through the editor and flushes before returning', async () => {
    const { flush, setActiveBlockId } = installEditor()

    const address = await ensureActiveBlockAddress(context())

    expect(address.id).toMatch(/^[0-9a-z]{8}$/)
    expect(setActiveBlockId).toHaveBeenCalledWith(address.id)
    expect(flush).toHaveBeenCalledOnce()
    expect(address).toMatchObject({
      path: 'notes/project.md',
      noteTitle: 'Project',
      blockText: 'Keep Markdown',
      generation: 7,
    })
  })

  it('keeps an existing unique ID and refuses duplicates', async () => {
    const existing = installEditor({
      markdown: '# Project\n\n- Keep Markdown ^alpha\n',
      active: { kind: 'listItem', id: 'alpha', ordinal: 0, text: 'Keep Markdown' },
    })
    await expect(ensureActiveBlockAddress(context())).resolves.toMatchObject({ id: 'alpha' })
    expect(existing.setActiveBlockId).not.toHaveBeenCalled()
    cleanups.splice(0).reverse().forEach((cleanup) => cleanup())

    installEditor({
      markdown: '# Project\n\n- Keep Markdown ^alpha\n- Duplicate ^alpha\n',
      active: { kind: 'listItem', id: 'alpha', ordinal: 0, text: 'Keep Markdown' },
    })
    await expect(ensureActiveBlockAddress(context())).rejects.toThrow('duplicated')
  })

  it('refuses unavailable selections, protected sessions, and failed saves', async () => {
    installEditor({ active: null })
    await expect(ensureActiveBlockAddress(context())).rejects.toThrow('list item')
    cleanups.splice(0).reverse().forEach((cleanup) => cleanup())

    installEditor({ writable: false })
    await expect(ensureActiveBlockAddress(context())).rejects.toThrow('cannot save')
    cleanups.splice(0).reverse().forEach((cleanup) => cleanup())

    installEditor({ flushFails: true })
    await expect(ensureActiveBlockAddress(context())).rejects.toThrow('could not be saved')
  })
})

describe('ensureBlockAddress', () => {
  it('mutates an open target through its editor/session and formats the result', async () => {
    const installed = installEditor()
    const address = await ensureBlockAddress({
      notePath: 'notes/project.md',
      locator: { ordinal: 0, expectedText: 'Keep Markdown' },
      indexedBlockId: null,
      generation: 7,
    })

    expect(installed.flush).toHaveBeenCalled()
    expect(formatBlockAddressReference(address)).toMatch(
      /^\[\[Project#\^[0-9a-z]{8}\|Keep Markdown\]\]$/,
    )
  })

  it('edits a closed note on disk and refuses stale locators', async () => {
    let source = '# Closed\n\n- Target block\n'
    const invoke = vi.fn(async (command: string, args: Record<string, unknown>) => {
      if (command === 'note_read') {
        return source
      }
      if (command === 'note_write') {
        source = String(args['contents'])
        return null
      }
      throw new Error(`unexpected command: ${command}`)
    })
    setBridge({ invoke, listen: async () => () => {} })

    const address = await ensureBlockAddress({
      notePath: 'notes/closed.md',
      locator: { ordinal: 0, expectedText: 'Target block' },
      indexedBlockId: null,
      generation: 7,
    })
    expect(source).toContain(`^${address.id}`)
    await expect(
      ensureBlockAddress({
        notePath: 'notes/closed.md',
        locator: { ordinal: 0, expectedText: 'Changed' },
        indexedBlockId: address.id,
        generation: 7,
      }),
    ).rejects.toThrow('changed')
  })
})

describe('runCopyBlockReference', () => {
  it('drops the copy when the graph generation changes during persistence', async () => {
    const installed = installEditor({
      markdown: '# Project\n\n- Keep Markdown ^alpha\n',
      active: { kind: 'listItem', id: 'alpha', ordinal: 0, text: 'Keep Markdown' },
    })
    let releaseFlush: () => void = () => {}
    installed.flush.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseFlush = resolve
      }),
    )
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    let generation = 7
    const commandContext = context()
    commandContext.generation = () => generation

    const copying = runCopyBlockReference(commandContext)
    await vi.waitFor(() => expect(installed.flush).toHaveBeenCalled())
    generation = 8
    releaseFlush()
    await copying

    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies only after persistence and reports clipboard failures', async () => {
    installEditor({
      markdown: '# Project\n\n- Keep Markdown ^alpha\n',
      active: { kind: 'listItem', id: 'alpha', ordinal: 0, text: 'Keep Markdown' },
    })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await runCopyBlockReference(context())
    expect(writeText).toHaveBeenCalledWith('[[Project#^alpha|Keep Markdown]]')
    expect(formatBlockAddressEmbed({ noteAddress: 'Project', id: 'alpha' })).toBe(
      '![[Project#^alpha]]',
    )
    await runCopyBlockEmbed(context())
    expect(writeText).toHaveBeenLastCalledWith('![[Project#^alpha]]')

    writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(runCopyBlockReference(context())).resolves.toBeUndefined()
  })
})
