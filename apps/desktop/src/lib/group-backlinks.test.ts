import { describe, expect, it } from 'vitest'
import type { BacklinkContext } from '@reflect/core'
import { groupBacklinksBySource } from './group-backlinks'

function context(
  sourcePath: string,
  sourceTitle: string,
  snippet: string,
  posFrom: number,
): BacklinkContext {
  return {
    sourcePath,
    sourceTitle,
    snippet,
    posFrom,
    tasks: [],
    fragmentKind: null,
    fragmentValue: null,
    wikiSyntax: 'reference',
    blockAvailability: null,
    targetBlockId: null,
    targetBlockOrdinal: null,
    targetBlockText: null,
  }
}

describe('groupBacklinksBySource', () => {
  it('groups rows by source note, preserving order and per-link keys', () => {
    const groups = groupBacklinksBySource([
      context('notes/a.md', 'A', 'first [[t]]', 4),
      context('notes/a.md', 'A', 'second [[t]]', 40),
      context('notes/b.md', 'B', 'only [[t]]', 9),
    ])

    expect(groups).toEqual([
      {
        path: 'notes/a.md',
        title: 'A',
        snippets: [
          {
            key: 'notes/a.md:4::',
            text: 'first [[t]]',
            tasks: [],
            fragmentKind: null,
            fragmentValue: null,
            blockAvailability: null,
            targetBlockText: null,
          },
          {
            key: 'notes/a.md:40::',
            text: 'second [[t]]',
            tasks: [],
            fragmentKind: null,
            fragmentValue: null,
            blockAvailability: null,
            targetBlockText: null,
          },
        ],
      },
      {
        path: 'notes/b.md',
        title: 'B',
        snippets: [
          {
            key: 'notes/b.md:9::',
            text: 'only [[t]]',
            tasks: [],
            fragmentKind: null,
            fragmentValue: null,
            blockAvailability: null,
            targetBlockText: null,
          },
        ],
      },
    ])
  })

  it('drops empty snippets but keeps the source group', () => {
    const groups = groupBacklinksBySource([
      context('notes/gone.md', 'Gone', '', 0),
    ])
    expect(groups).toEqual([{ path: 'notes/gone.md', title: 'Gone', snippets: [] }])
  })
})
