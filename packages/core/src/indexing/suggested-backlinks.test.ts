import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { getSuggestedBacklinks } from './suggested-backlinks'

const mockInvoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  mockInvoke.mockReset()
  setBridge({ invoke: mockInvoke, listen: async () => () => {} })
})

afterEach(() => {
  setBridge(null)
})

describe('getSuggestedBacklinks', () => {
  it('narrows with body FTS, excludes existing backlinks, and confirms live Markdown', async () => {
    const source = '# Journal\n\nCalled Mum about the trip.\n'
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'note_read') {
        return source
      }
      const query = String(args['sql'])
      if (query.includes('from "notes"') && query.includes('"daily_date"')) {
        return [{ title: 'Charlotte MacCaw', daily_date: null }]
      }
      if (query.includes('from "aliases"')) {
        return [{ alias: 'Mum' }]
      }
      if (query.includes('from "note_keys"')) {
        return [{ key: 'charlotte maccaw' }, { key: 'mum' }]
      }
      if (query.includes('from "search_fts"')) {
        return [{ path: 'daily/2026-07-01.md', title: '2026-07-01' }]
      }
      throw new Error(`unexpected query: ${query}`)
    })

    await expect(getSuggestedBacklinks('notes/charlotte.md', 6)).resolves.toEqual([
      {
        sourcePath: 'daily/2026-07-01.md',
        sourceTitle: '2026-07-01',
        snippet: 'Called Mum about the trip.',
        from: source.indexOf('Mum'),
        to: source.indexOf('Mum') + 3,
        text: 'Mum',
        target: 'Charlotte MacCaw',
      },
    ])

    const candidateCall = mockInvoke.mock.calls.find(
      ([command, args]) => command === 'db_query' && String(args['sql']).includes('search_fts'),
    )
    expect(candidateCall).toBeDefined()
    const sql = String(candidateCall?.[1]['sql'])
    expect(sql.toLowerCase()).toContain('search_fts match')
    expect(sql).toContain('not exists')
    expect(sql).toContain('backlinks')
    expect(candidateCall?.[1]['params']).toContain(
      'body : ("Charlotte MacCaw" OR "Mum")',
    )
  })

  it('drops parser-rejected candidates even when FTS matched them', async () => {
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'note_read') {
        return '`Ada` and [[Ada]]\n'
      }
      const query = String(args['sql'])
      if (query.includes('from "notes"') && query.includes('"daily_date"')) {
        return [{ title: 'Ada', daily_date: null }]
      }
      if (query.includes('from "aliases"')) {
        return []
      }
      if (query.includes('from "note_keys"')) {
        return [{ key: 'ada' }]
      }
      if (query.includes('from "search_fts"')) {
        return [{ path: 'notes/source.md', title: 'Source' }]
      }
      throw new Error(`unexpected query: ${query}`)
    })

    await expect(getSuggestedBacklinks('notes/ada.md')).resolves.toEqual([])
  })
})
