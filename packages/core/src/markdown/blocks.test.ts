import { describe, expect, it } from 'vitest'
import { findDuplicateBlockIds } from './blocks'
import { parseNote } from './extract'

function blocks(source: string) {
  return parseNote({ path: 'notes/blocks.md', source }).blocks
}

describe('list block extraction', () => {
  it('extracts ordinary, nested, ordered, collapsed, and task list items', () => {
    const source = [
      '- Parent ^parent1',
      '  - Child ^child1',
      '+ Collapsed ^collapsed1',
      '- [ ] Square ^square1',
      '+ [x] Round ^round1',
      '1. Ordered ^ordered1',
    ].join('\n')

    expect(
      blocks(source).map((block) => ({
        ordinal: block.ordinal,
        id: block.id,
        text: block.text,
        breadcrumbs: block.breadcrumbs,
      })),
    ).toEqual([
      { ordinal: 0, id: 'parent1', text: 'Parent', breadcrumbs: [] },
      { ordinal: 1, id: 'child1', text: 'Child', breadcrumbs: ['Parent'] },
      { ordinal: 2, id: 'collapsed1', text: 'Collapsed', breadcrumbs: [] },
      { ordinal: 3, id: 'square1', text: 'Square', breadcrumbs: [] },
      { ordinal: 4, id: 'round1', text: 'Round', breadcrumbs: [] },
      { ordinal: 5, id: 'ordered1', text: 'Ordered', breadcrumbs: [] },
    ])
  })

  it('returns display markdown for the subtree without any contained IDs', () => {
    const source = '- Parent ^parent1\n  - Child ^child1\n'
    const parsed = blocks(source)
    expect(parsed[0]!.markdown).toBe('- Parent\n  - Child')
    expect(parsed[1]!.markdown).toBe('- Child')
  })

  it('uses whole-file offsets with frontmatter and CRLF', () => {
    const source = '---\r\ntitle: Blocks\r\n---\r\n- Item ^block1\r\n'
    const block = blocks(source)[0]!
    expect(source.slice(block.from, block.to)).toBe('- Item ^block1\r')
    expect(source.slice(block.markerSpan!.from, block.markerSpan!.to)).toBe('^block1')
    expect(source.slice(block.leadFrom, block.leadTo)).toBe('Item ^block1\r')
  })

  it('recognizes a marker only on the lead physical line', () => {
    expect(blocks('- first line\n  second ^later1')[0]!.id).toBeNull()
    expect(blocks('- first ^first1\n  second line')[0]!.id).toBe('first1')
  })

  it('does not recognize invalid or syntax-contained carets', () => {
    const source = [
      '- numeric ^1234',
      '- underscore ^bad_id',
      '- code `^codeid`',
      '- wiki [[Target|^wikiid]]',
      '- escaped \\^escaped1',
    ].join('\n')
    expect(blocks(source).map((block) => block.id)).toEqual([null, null, null, null, null])
  })

  it('removes markers from every derived display field', () => {
    const note = parseNote({
      path: 'notes/blocks.md',
      source: '- Parent ^parent1\n  + [ ] Child ^child1\n',
    })
    expect(note.text).not.toContain('^parent1')
    expect(note.text).not.toContain('^child1')
    expect(note.tasks[0]!.text).toBe('Child')
    expect(note.tasks[0]!.breadcrumbs).toEqual(['Parent'])
    expect(note.blocks.flatMap((block) => [block.text, block.markdown, ...block.breadcrumbs]).join(' ')).not.toContain('^')
  })

  it('reports duplicate IDs without rejecting the note', () => {
    const parsed = blocks('- One ^same1\n- Two ^same1\n')
    expect(findDuplicateBlockIds(parsed)).toEqual([
      {
        id: 'same1',
        blocks: [
          { ordinal: 0, span: { from: 0, to: 12 } },
          { ordinal: 1, span: { from: 13, to: 25 } },
        ],
      },
    ])
  })
})

describe('wiki syntax extraction', () => {
  it('distinguishes references from embeds', () => {
    const note = parseNote({
      path: 'notes/blocks.md',
      source: '[[Project#^block1|Decision]]\n\n![[Project#^block1]]\n',
    })
    expect(note.wikiLinks.map(({ syntax, target, alias }) => ({ syntax, target, alias }))).toEqual([
      { syntax: 'reference', target: 'Project#^block1', alias: 'Decision' },
      { syntax: 'embed', target: 'Project#^block1', alias: undefined },
    ])
  })
})
