import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptSuggestedBacklink, SuggestedBacklinkBusyError } from './suggested-backlink'

const openSession = vi.hoisted(() => vi.fn())
const readNote = vi.hoisted(() => vi.fn())
const writeNote = vi.hoisted(() => vi.fn())
vi.mock('@/editor/open-documents', () => ({ openSession }))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readNote,
  writeNote,
}))

const source = 'Called Mum.\n'
const suggestion = {
  sourcePath: 'daily/2026-07-01.md',
  sourceTitle: '2026-07-01',
  snippet: 'Called Mum.',
  from: source.indexOf('Mum'),
  to: source.indexOf('Mum') + 3,
  text: 'Mum',
  target: 'Charlotte MacCaw',
}

beforeEach(() => {
  openSession.mockReset().mockReturnValue(null)
  readNote.mockReset().mockResolvedValue(source)
  writeNote.mockReset().mockResolvedValue(undefined)
})

describe('acceptSuggestedBacklink', () => {
  it('writes the validated link to a closed source note', async () => {
    await acceptSuggestedBacklink(suggestion, 7)

    expect(writeNote).toHaveBeenCalledWith(
      'daily/2026-07-01.md',
      'Called [[Charlotte MacCaw|Mum]].\n',
      7,
    )
  })

  it('uses an open note session so unsaved edits are not clobbered', async () => {
    const commitSuggestedBacklink = vi.fn().mockResolvedValue(true)
    openSession.mockReturnValue({ commitSuggestedBacklink })

    await acceptSuggestedBacklink(suggestion, 7)

    expect(commitSuggestedBacklink).toHaveBeenCalledWith({
      from: suggestion.from,
      to: suggestion.to,
      text: 'Mum',
      target: 'Charlotte MacCaw',
    })
    expect(readNote).not.toHaveBeenCalled()
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('refuses instead of falling back to disk when an open session is busy', async () => {
    openSession.mockReturnValue({
      commitSuggestedBacklink: vi.fn().mockResolvedValue(false),
    })

    await expect(acceptSuggestedBacklink(suggestion, 7)).rejects.toBeInstanceOf(
      SuggestedBacklinkBusyError,
    )
    expect(writeNote).not.toHaveBeenCalled()
  })
})
