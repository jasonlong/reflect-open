import { render } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteEditorHandle } from '@/editor/note-editor'
import { RouterProvider, useRouter } from '@/routing/router'
import { useNoteFragmentReveal } from './use-note-fragment-reveal'

const operationWarn = vi.hoisted(() => vi.fn())
vi.mock('@/lib/operations', () => ({
  startOperation: () => ({ warn: operationWarn }),
}))

function editorHandle(): NoteEditorHandle {
  return {
    getMarkdown: () => '',
    setMarkdown: () => {},
    insertMarkdown: () => {},
    focus: vi.fn(),
    setSelection: () => {},
    getSelectedText: () => '',
    openSelectionMenu: () => {},
    startPendingReplacement: () => false,
    appendPendingReplacementText: () => {},
    acceptPendingReplacement: () => {},
    discardPendingReplacement: () => {},
    getActiveBlock: () => null,
    setActiveBlockId: () => false,
    setBlockId: () => false,
    revealHeading: vi.fn(() => true),
    revealBlock: vi.fn(() => true),
    refreshMarkdownRendering: () => {},
  }
}

let router: ReturnType<typeof useRouter> | null = null

function Host({
  path,
  ready,
  editor,
}: {
  path: string
  ready: boolean
  editor: NoteEditorHandle | null
}): null {
  router = useRouter()
  useNoteFragmentReveal({ path, ready, editor })
  return null
}

function Harness({ children }: { children: ReactNode }): ReactNode {
  return (
    <RouterProvider
      initialRoute={{
        kind: 'note',
        path: 'notes/a.md',
        fragment: { kind: 'block', id: 'alpha' },
      }}
    >
      {children}
    </RouterProvider>
  )
}

beforeEach(() => {
  router = null
  operationWarn.mockReset()
})

describe('useNoteFragmentReveal', () => {
  it('waits for readiness and attachment, then reveals once per arrival', () => {
    const editor = editorHandle()
    const view = render(
      <Harness>
        <Host path="notes/a.md" ready={false} editor={null} />
      </Harness>,
    )
    expect(editor.revealBlock).not.toHaveBeenCalled()

    view.rerender(
      <Harness>
        <Host path="notes/a.md" ready={true} editor={editor} />
      </Harness>,
    )
    expect(editor.revealBlock).toHaveBeenCalledTimes(1)
    expect(editor.revealBlock).toHaveBeenCalledWith({ id: 'alpha' })

    view.rerender(
      <Harness>
        <Host path="notes/a.md" ready={true} editor={editor} />
      </Harness>,
    )
    expect(editor.revealBlock).toHaveBeenCalledTimes(1)

    act(() => {
      router?.navigate({
        kind: 'note',
        path: 'notes/a.md',
        fragment: { kind: 'blockPosition', ordinal: 2, expectedText: 'Decision' },
      })
    })
    expect(editor.revealBlock).toHaveBeenCalledTimes(2)
    expect(editor.revealBlock).toHaveBeenLastCalledWith({
      ordinal: 2,
      expectedText: 'Decision',
    })
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('reveals headings again when history returns to their entry', () => {
    const editor = editorHandle()
    const view = render(
      <RouterProvider
        initialRoute={{
          kind: 'note',
          path: 'notes/a.md',
          fragment: { kind: 'heading', value: 'Plan' },
        }}
      >
        <Host path="notes/a.md" ready={true} editor={editor} />
      </RouterProvider>,
    )
    expect(editor.revealHeading).toHaveBeenCalledWith('Plan')

    act(() => router?.navigate({ kind: 'tasks' }))
    act(() => router?.back())
    expect(editor.revealHeading).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('keeps the note open and reports a stale target without retrying', () => {
    const editor = editorHandle()
    vi.mocked(editor.revealBlock).mockReturnValue(false)
    const view = render(
      <Harness>
        <Host path="notes/a.md" ready={true} editor={editor} />
      </Harness>,
    )

    expect(operationWarn).toHaveBeenCalledWith('That block is no longer available.')
    view.rerender(
      <Harness>
        <Host path="notes/a.md" ready={true} editor={editor} />
      </Harness>,
    )
    expect(editor.revealBlock).toHaveBeenCalledTimes(1)
  })
})
