import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBlockTransclusion } from './use-block-transclusion'

const mocks = vi.hoisted(() => ({
  resolveWikiAddress: vi.fn(),
  readExistingNoteSource: vi.fn(),
}))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  resolveWikiAddress: mocks.resolveWikiAddress,
}))
vi.mock('@/lib/read-existing-note-source', () => ({
  readExistingNoteSource: mocks.readExistingNoteSource,
}))
vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: null }) }))

beforeEach(() => {
  mocks.resolveWikiAddress.mockReset().mockResolvedValue({
    kind: 'block', path: 'notes/plan.md', blockId: 'alpha', ordinal: 0, text: 'Indexed',
  })
  mocks.readExistingNoteSource.mockReset().mockResolvedValue(
    '# Plan\n\n- Live text ^alpha\n  - Child\n',
  )
})

describe('resolveBlockTransclusion', () => {
  it('reads live source and returns marker-free source Markdown', async () => {
    await expect(resolveBlockTransclusion('Plan#^alpha', 7)).resolves.toMatchObject({
      kind: 'resolved',
      path: 'notes/plan.md',
      blockId: 'alpha',
      noteTitle: 'Plan',
      text: 'Live text',
      markdown: '- Live text\n  - Child',
    })
    expect(mocks.readExistingNoteSource).toHaveBeenCalledWith('notes/plan.md', 7)
  })

  it('renders private source locally without changing resolution semantics', async () => {
    mocks.readExistingNoteSource.mockResolvedValueOnce(
      '---\nprivate: true\n---\n# Plan\n\n- Local only ^alpha\n',
    )
    await expect(resolveBlockTransclusion('Plan#^alpha', 7)).resolves.toMatchObject({
      kind: 'resolved',
      text: 'Local only',
    })
  })

  it('refuses stale, duplicate, and deleted source IDs', async () => {
    mocks.readExistingNoteSource.mockResolvedValueOnce('# Plan\n\n- No marker\n')
    await expect(resolveBlockTransclusion('Plan#^alpha', 7)).resolves.toEqual({
      kind: 'missingBlock', target: 'Plan#^alpha', path: 'notes/plan.md',
    })

    mocks.readExistingNoteSource.mockResolvedValueOnce(
      '# Plan\n\n- One ^alpha\n- Two ^alpha\n',
    )
    await expect(resolveBlockTransclusion('Plan#^alpha', 7)).resolves.toEqual({
      kind: 'ambiguousBlock', target: 'Plan#^alpha', path: 'notes/plan.md',
    })
  })

  it('distinguishes missing notes, ambiguous index claims, and read errors', async () => {
    mocks.resolveWikiAddress.mockResolvedValueOnce({ kind: 'missing', target: 'Gone#^a' })
    await expect(resolveBlockTransclusion('Gone#^a', 7)).resolves.toEqual({
      kind: 'missingNote', target: 'Gone#^a',
    })

    mocks.resolveWikiAddress.mockResolvedValueOnce({
      kind: 'ambiguousBlock', path: 'notes/plan.md', blockId: 'a', count: 2,
    })
    await expect(resolveBlockTransclusion('Plan#^a', 7)).resolves.toEqual({
      kind: 'ambiguousBlock', target: 'Plan#^a', path: 'notes/plan.md',
    })

    mocks.readExistingNoteSource.mockRejectedValueOnce({ kind: 'io', message: 'offline' })
    await expect(resolveBlockTransclusion('Plan#^alpha', 7)).resolves.toEqual({
      kind: 'error', target: 'Plan#^alpha',
    })
  })

  it('stops cycles and excessive nesting before reading source', async () => {
    await expect(resolveBlockTransclusion('Plan#^alpha', 7, {
      visitedAddresses: new Set(['notes/plan.md#^alpha']), depth: 1,
    })).resolves.toEqual({ kind: 'cycle', target: 'Plan#^alpha' })
    await expect(resolveBlockTransclusion('Plan#^alpha', 7, { depth: 3 })).resolves.toEqual({
      kind: 'cycle', target: 'Plan#^alpha',
    })
    expect(mocks.readExistingNoteSource).not.toHaveBeenCalled()
  })
})
