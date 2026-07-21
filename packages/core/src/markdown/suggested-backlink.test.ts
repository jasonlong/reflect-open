import { describe, expect, it } from 'vitest'
import {
  addSuggestedBacklink,
  findSuggestedBacklinkMention,
  SuggestedBacklinkStaleError,
} from './suggested-backlink'

describe('findSuggestedBacklinkMention', () => {
  it('finds a whole, case-insensitive alias and preserves source coordinates', () => {
    const source = '---\naliases: []\n---\n# People\n\nMet ADA yesterday.\n'

    expect(findSuggestedBacklinkMention(source, ['Ada'], 'Ada Lovelace')).toEqual({
      from: source.indexOf('ADA'),
      to: source.indexOf('ADA') + 3,
      text: 'ADA',
      target: 'Ada Lovelace',
    })
  })

  it('prefers the longest spelling at the same location', () => {
    const source = '# Notes\n\nAda Lovelace wrote about engines.\n'

    expect(findSuggestedBacklinkMention(source, ['Ada', 'Ada Lovelace'], 'Ada Lovelace')?.text).toBe(
      'Ada Lovelace',
    )
  })

  it('does not match substrings inside words', () => {
    expect(findSuggestedBacklinkMention('A Canadian trip\n', ['Ada'], 'Ada')).toBeNull()
  })

  it('ignores the source title, code, existing links, and Markdown links', () => {
    const source = [
      '# Ada notes',
      '',
      '`Ada`',
      '',
      '```',
      'Ada',
      '```',
      '',
      '[[Ada]]',
      '',
      '[Ada](https://example.com)',
    ].join('\n')

    expect(findSuggestedBacklinkMention(source, ['Ada'], 'Ada')).toBeNull()
  })
})

describe('addSuggestedBacklink', () => {
  it('wraps a canonical mention with a minimal wiki link', () => {
    const source = '# Notes\n\nMet Ada yesterday.\n'
    const mention = findSuggestedBacklinkMention(source, ['Ada'], 'Ada')
    expect(mention).not.toBeNull()

    expect(addSuggestedBacklink(source, mention!)).toBe('# Notes\n\nMet [[Ada]] yesterday.\n')
  })

  it('uses an alias to preserve the mention text', () => {
    const source = 'Called Mum.\n'
    const mention = findSuggestedBacklinkMention(source, ['Mum'], 'Charlotte MacCaw')
    expect(mention).not.toBeNull()

    expect(addSuggestedBacklink(source, mention!)).toBe(
      'Called [[Charlotte MacCaw|Mum]].\n',
    )
  })

  it('refuses when the source changed after the suggestion was read', () => {
    const source = 'Called Mum.\n'
    const mention = findSuggestedBacklinkMention(source, ['Mum'], 'Charlotte MacCaw')
    expect(mention).not.toBeNull()

    expect(() => addSuggestedBacklink('Called Dad.\n', mention!)).toThrow(
      SuggestedBacklinkStaleError,
    )
  })
})
