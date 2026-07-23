import { describe, expect, it } from 'vitest'
import { BlockLocatorStaleError, ensureBlockId } from './edit-block-id'

describe('ensureBlockId', () => {
  it('returns an existing unique ID byte-exactly', () => {
    const source = '- Addressed ^alpha\n'
    expect(ensureBlockId(source, { ordinal: 0, expectedText: 'Addressed' })).toEqual({
      kind: 'existing',
      id: 'alpha',
      source,
    })
  })

  it('assigns IDs to nested, ordered, and task blocks while preserving CRLF', () => {
    const source = '- Parent\r\n  1. Nested\r\n+ [ ] Task\r\n'
    expect(
      ensureBlockId(source, { ordinal: 1, expectedText: 'Nested' }, 'nested-id').source,
    ).toBe('- Parent\r\n  1. Nested ^nested-id\r\n+ [ ] Task\r\n')
    expect(
      ensureBlockId(source, { ordinal: 2, expectedText: 'Task' }, 'task-id').source,
    ).toBe('- Parent\r\n  1. Nested\r\n+ [ ] Task ^task-id\r\n')
  })

  it('never relocates repeated text and rejects stale or colliding locators', () => {
    const source = '- Same\n- Same\n- Other ^taken\n'
    expect(ensureBlockId(source, { ordinal: 1, expectedText: 'Same' }, 'second').source).toBe(
      '- Same\n- Same ^second\n- Other ^taken\n',
    )
    expect(() => ensureBlockId(source, { ordinal: 0, expectedText: 'Changed' })).toThrow(
      BlockLocatorStaleError,
    )
    expect(() => ensureBlockId(source, { ordinal: 9, expectedText: 'Same' })).toThrow(
      BlockLocatorStaleError,
    )
    expect(() => ensureBlockId(source, { ordinal: 0, expectedText: 'Same' }, 'taken')).toThrow(
      'already in use',
    )
  })

  it('refuses duplicate existing IDs', () => {
    const source = '- One ^dupe\n- Two ^dupe\n'
    expect(() => ensureBlockId(source, { ordinal: 0, expectedText: 'One' })).toThrow('ambiguous')
  })
})
