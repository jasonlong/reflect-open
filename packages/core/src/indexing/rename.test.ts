import { describe, expect, it } from 'vitest'
import {
  foldKey,
  parseNote,
  parseWikiAddressCandidates,
  resolved,
  unresolved,
} from '../markdown'
import {
  nextAliases,
  rewriteLinksForTitleChange,
  type RenameIo,
  type RenameLinkCandidate,
} from './rename'

function fakeIo(
  files: Record<string, string>,
  options?: { resolveTo?: string; resolveByTarget?: Record<string, string> },
) {
  const writes: Record<string, string> = {}
  const io: RenameIo = {
    sources: async (targetKey) =>
      Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([sourcePath, source]) => {
          const candidates = parseNote({ path: sourcePath, source }).wikiLinks.flatMap<RenameLinkCandidate>((link) => {
            const address = parseWikiAddressCandidates(link.target)
            if (foldKey(address.exactTarget) === targetKey) {
              return [{ target: link.target, mode: 'exact' as const }]
            }
            if (
              address.fragmented !== null &&
              foldKey(address.fragmented.noteTarget) === targetKey
            ) {
              return [{ target: link.target, mode: 'fragment-base' as const }]
            }
            return []
          })
          return candidates.length === 0 ? [] : [{ sourcePath, candidates }]
        }),
    read: async (path) => {
      const content = files[path]
      if (content === undefined) {
        throw new Error(`unreadable: ${path}`)
      }
      return content
    },
    write: async (path, content) => {
      writes[path] = content
    },
    resolve: async (target) => {
      const mapped = options?.resolveByTarget?.[target]
      if (mapped !== undefined) {
        return resolved(mapped)
      }
      return options?.resolveTo !== undefined ? resolved(options.resolveTo) : unresolved('x')
    },
  }
  return { io, writes }
}

describe('rewriteLinksForTitleChange', () => {
  it('rewrites [[from]] links across sources, preserving aliases', async () => {
    const { io, writes } = fakeIo({
      'notes/a.md': 'See [[Old Title]] for context.\n',
      'notes/b.md': 'Alias form: [[old title|the doc]].\n',
    })
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old Title',
      to: 'New Title',
      io,
    })
    expect(result).toEqual({
      rewritten: ['notes/a.md', 'notes/b.md'],
      failed: [],
      collision: false,
      destinationBlocked: false,
    })
    expect(writes['notes/a.md']).toBe('See [[New Title]] for context.\n')
    expect(writes['notes/b.md']).toBe('Alias form: [[New Title|the doc]].\n')
  })

  it('skips the renamed note itself and sources without a rewritable link', async () => {
    const { io, writes } = fakeIo({
      'notes/target.md': '# New Title\n[[Old Title]] self-reference\n',
      'notes/c.md': 'mentions Old Title in prose only\n',
    })
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old Title',
      to: 'New Title',
      io,
    })
    expect(result.rewritten).toEqual([])
    expect(writes).toEqual({})
  })

  it('never rewrites link-shaped text inside code contexts', async () => {
    const { io, writes } = fakeIo({
      'notes/code.md':
        'Real: [[Old]]\n\n```\n[[Old]] in a fence\n```\n\nAnd `[[Old]] inline`.\n',
    })
    await rewriteLinksForTitleChange({ path: 'notes/t.md', from: 'Old', to: 'New', io })
    expect(writes['notes/code.md']).toBe(
      'Real: [[New]]\n\n```\n[[Old]] in a fence\n```\n\nAnd `[[Old]] inline`.\n',
    )
  })

  it('preserves heading and block fragments, aliases, and embed syntax', async () => {
    const { io, writes } = fakeIo({
      'notes/source.md':
        '[[Old#Plan]]\n[[Old#^abc|decision]]\n![[Old#^embed]]\n',
    })
    await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old',
      to: 'New',
      io,
    })
    expect(writes['notes/source.md']).toBe(
      '[[New#Plan]]\n[[New#^abc|decision]]\n![[New#^embed]]\n',
    )
  })

  it('does not rewrite a literal hash title excluded by exact-first resolution', async () => {
    const files = {
      'notes/source.md': '[[Old#Literal]] and [[Old#Other]] and [[Old]]\n',
    }
    const { io, writes } = fakeIo(files)
    io.sources = async () => [
      {
        sourcePath: 'notes/source.md',
        candidates: [
          { target: 'Old#Other', mode: 'fragment-base' },
          { target: 'Old', mode: 'exact' },
        ],
      },
    ]
    await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old',
      to: 'New',
      io,
    })
    expect(writes['notes/source.md']).toBe(
      '[[Old#Literal]] and [[New#Other]] and [[New]]\n',
    )
  })

  it('leaves links alone when the old title belongs to a different note now', async () => {
    const { io, writes } = fakeIo(
      { 'notes/a.md': '[[Old Title]]\n' },
      { resolveTo: 'notes/other-owner.md' },
    )
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old Title',
      to: 'New Title',
      io,
    })
    expect(result.collision).toBe(true)
    expect(writes).toEqual({})
  })

  it('a stale index resolving to the renamed note itself is not a collision', async () => {
    const { io, writes } = fakeIo(
      { 'notes/a.md': '[[Old Title]]\n' },
      { resolveTo: 'notes/target.md' },
    )
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old Title',
      to: 'New Title',
      io,
    })
    expect(result.collision).toBe(false)
    expect(writes['notes/a.md']).toBe('[[New Title]]\n')
  })

  it('continues past a failing source and reports it', async () => {
    const files: Record<string, string> = { 'notes/ok.md': '[[Old]] here\n' }
    const { io, writes } = fakeIo(files)
    const sources = [
      {
        sourcePath: 'notes/gone.md',
        candidates: [{ target: 'Old', mode: 'exact' as const }],
      },
      {
        sourcePath: 'notes/ok.md',
        candidates: [{ target: 'Old', mode: 'exact' as const }],
      },
    ] // gone.md read throws
    io.sources = async () => sources
    const progress: Array<[number, number]> = []
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old',
      to: 'New',
      io,
      onProgress: (done, total) => progress.push([done, total]),
    })
    expect(result.failed).toEqual(['notes/gone.md'])
    expect(result.rewritten).toEqual(['notes/ok.md'])
    expect(writes['notes/ok.md']).toBe('[[New]] here\n')
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('rewriteLinksForTitleChange write failures', () => {
  it('continues past a write failure and reports it', async () => {
    const { io, writes } = fakeIo({
      'notes/fail.md': '[[Old]]\n',
      'notes/ok.md': '[[Old]]\n',
    })
    const write = io.write
    io.write = async (path, content) => {
      if (path === 'notes/fail.md') {
        throw new Error('write failed')
      }
      await write(path, content)
    }
    const result = await rewriteLinksForTitleChange({
      path: 'notes/target.md',
      from: 'Old',
      to: 'New',
      io,
    })
    expect(result.failed).toEqual(['notes/fail.md'])
    expect(result.rewritten).toEqual(['notes/ok.md'])
    expect(writes['notes/ok.md']).toBe('[[New]]\n')
    expect(writes['notes/fail.md']).toBeUndefined()
  })
})

describe('nextAliases', () => {
  it('adds the old title and prunes the previous auto-alias', () => {
    expect(
      nextAliases(['First', 'keeper'], {
        from: 'Second',
        to: 'Third',
        previousAutoAlias: 'First',
      }),
    ).toEqual(['keeper', 'Second'])
  })

  it('does not duplicate an existing alias (case-insensitive)', () => {
    expect(
      nextAliases(['old title'], { from: 'Old Title', to: 'New', previousAutoAlias: null }),
    ).toBeNull()
  })

  it('returns null when nothing changes', () => {
    expect(
      nextAliases([], { from: 'Same', to: 'same', previousAutoAlias: null }),
    ).toBeNull()
  })

  it('adds the first alias to an empty list', () => {
    expect(nextAliases([], { from: 'Old', to: 'New', previousAutoAlias: null })).toEqual(['Old'])
  })
})

describe('rewriteLinksForTitleChange — rich titles', () => {
  it('rewrites links in the derived linkable space, not the raw title', async () => {
    const { io, writes } = fakeIo({
      'notes/source.md': 'See [[Meeting with Ada]] tomorrow.',
    })
    const result = await rewriteLinksForTitleChange({
      path: 'notes/meeting.md',
      from: 'Meeting with [[Ada Lovelace|Ada]]',
      to: 'Meeting with [[Grace Hopper|Grace]]',
      io,
    })
    expect(result).toEqual({
      rewritten: ['notes/source.md'],
      failed: [],
      collision: false,
      destinationBlocked: false,
    })
    expect(writes['notes/source.md']).toBe('See [[Meeting with Grace]] tomorrow.')
  })

  it('keeps a trivial title byte-for-byte (double spaces survive)', async () => {
    const { io, writes } = fakeIo({
      'notes/source.md': 'See [[Old  Title]].',
    })
    await rewriteLinksForTitleChange({
      path: 'notes/old.md',
      from: 'Old  Title',
      to: 'New Title',
      io,
    })
    expect(writes['notes/source.md']).toBe('See [[New Title]].')
  })

  it('nextAliases preserves the raw rich title, not its derived form', () => {
    expect(
      nextAliases([], {
        from: 'Meeting with [[Ada Lovelace|Ada]]',
        to: 'Weekly Sync',
        previousAutoAlias: null,
      }),
    ).toEqual(['Meeting with [[Ada Lovelace|Ada]]'])
  })
})

describe('rewriteLinksForTitleChange — destination guard', () => {
  it('does not rewrite when the new derived target already belongs to another note', async () => {
    const { io, writes } = fakeIo(
      { 'notes/source.md': 'See [[Old Meeting]].\n' },
      { resolveByTarget: { 'Meeting with Ada': 'notes/plain.md' } },
    )
    const result = await rewriteLinksForTitleChange({
      path: 'notes/a.md',
      from: 'Old Meeting',
      to: 'Meeting with [[Ada Lovelace|Ada]]',
      io,
    })
    expect(result).toEqual({
      rewritten: [],
      failed: [],
      collision: false,
      destinationBlocked: true,
    })
    expect(writes).toEqual({})
  })

  it('does not rewrite into an unserializable derived target', async () => {
    const { io, writes } = fakeIo({ 'notes/source.md': 'See [[Old Meeting]].\n' })
    const result = await rewriteLinksForTitleChange({
      path: 'notes/a.md',
      from: 'Old Meeting',
      to: 'C:\\notes [[Ada Lovelace|Ada]]',
      io,
    })
    expect(result).toEqual({
      rewritten: [],
      failed: [],
      collision: false,
      destinationBlocked: true,
    })
    expect(writes).toEqual({})
  })

  it('a destination already resolving to the renamed note itself is not blocked', async () => {
    const { io, writes } = fakeIo(
      { 'notes/source.md': 'See [[Old Meeting]].\n' },
      { resolveByTarget: { 'Meeting with Ada': 'notes/a.md' } },
    )
    const result = await rewriteLinksForTitleChange({
      path: 'notes/a.md',
      from: 'Old Meeting',
      to: 'Meeting with [[Ada Lovelace|Ada]]',
      io,
    })
    expect(result.destinationBlocked).toBe(false)
    expect(writes['notes/source.md']).toBe('See [[Meeting with Ada]].\n')
  })

  it('a source collision wins over a destination block (no alias may be claimed)', async () => {
    const { io, writes } = fakeIo(
      { 'notes/source.md': 'See [[Old Meeting]].\n' },
      {
        resolveByTarget: {
          'Old Meeting': 'notes/other-owner.md',
          'Meeting with Ada': 'notes/plain.md',
        },
      },
    )
    const result = await rewriteLinksForTitleChange({
      path: 'notes/a.md',
      from: 'Old Meeting',
      to: 'Meeting with [[Ada Lovelace|Ada]]',
      io,
    })
    expect(result).toEqual({
      rewritten: [],
      failed: [],
      collision: true,
      destinationBlocked: false,
    })
    expect(writes).toEqual({})
  })
})
