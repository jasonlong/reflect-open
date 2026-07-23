import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBlockId, newBlockId, parseWikiAddressCandidates } from './block-address'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseWikiAddressCandidates', () => {
  it('returns exact and block-fragment candidates', () => {
    expect(parseWikiAddressCandidates(' Project#^abc-123 ')).toEqual({
      exactTarget: 'Project#^abc-123',
      fragmented: {
        noteTarget: 'Project',
        fragment: { kind: 'block', id: 'abc-123' },
      },
    })
  })

  it('returns a heading candidate at the final separator', () => {
    expect(parseWikiAddressCandidates('Project#Plan#Decision')).toEqual({
      exactTarget: 'Project#Plan#Decision',
      fragmented: {
        noteTarget: 'Project#Plan',
        fragment: { kind: 'heading', value: 'Decision' },
      },
    })
  })

  it('keeps the full target for exact note-title resolution', () => {
    expect(parseWikiAddressCandidates('Project#Plan').exactTarget).toBe('Project#Plan')
  })

  it.each(['Project', '#Heading', 'Project#', 'Project#^1234', 'Project#^bad_id']) (
    'does not return an invalid fragment for %s',
    (target) => {
      expect(parseWikiAddressCandidates(target).fragmented).toBeNull()
    },
  )
})

describe('isBlockId', () => {
  it.each(['a', 'abc123', 'ABC-123', 'a'.repeat(64)])('accepts %s', (id) => {
    expect(isBlockId(id)).toBe(true)
  })

  it.each(['', '1234', 'with space', 'bad_id', 'a'.repeat(65)])('rejects %s', (id) => {
    expect(isBlockId(id)).toBe(false)
  })
})

describe('newBlockId', () => {
  it('uses the ambiguity-free alphabet and retries collisions', () => {
    let calls = 0
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array): Uint8Array {
        bytes.fill(calls === 0 ? 10 : 11)
        calls += 1
        return bytes
      },
    })

    expect(newBlockId(new Set(['aaaaaaaa']))).toBe('bbbbbbbb')
    expect(calls).toBe(2)
  })

  it('retries generated all-numeric IDs', () => {
    let calls = 0
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array): Uint8Array {
        bytes.fill(calls === 0 ? 1 : 10)
        calls += 1
        return bytes
      },
    })

    expect(newBlockId()).toBe('aaaaaaaa')
    expect(calls).toBe(2)
  })
})
