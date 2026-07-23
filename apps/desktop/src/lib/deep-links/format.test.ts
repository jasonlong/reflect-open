import { describe, expect, it } from 'vitest'
import type { Route } from '@/routing/route'
import { dailyDeepLink, deepLinkForRoute, noteDeepLink } from '@/lib/deep-links/format'
import { parseDeepLink } from '@/lib/deep-links/parse'

describe('deepLinkForRoute', () => {
  it('round-trips every addressable route through the parser', () => {
    const routes: Route[] = [
      { kind: 'today' },
      { kind: 'tasks' },
      { kind: 'daily', date: '2026-07-01' },
      { kind: 'search', query: 'meeting notes & more' },
    ]
    for (const route of routes) {
      const url = deepLinkForRoute(route)
      expect(url).not.toBeNull()
      expect(parseDeepLink(url ?? '')).toEqual({ kind: 'navigate', route })
    }
  })

  it('emits a path-shaped note link that parses back to the same target', () => {
    const url = deepLinkForRoute({ kind: 'note', path: 'notes/project x.md' })
    expect(url).toBe('reflect://note/notes%2Fproject%20x.md')
    expect(parseDeepLink(url ?? '')).toEqual({
      kind: 'openNote',
      target: 'notes/project x.md',
      fragment: null,
    })
  })

  it('returns null for unaddressed screens and positional fragments', () => {
    expect(deepLinkForRoute({ kind: 'allNotes', tag: null })).toBeNull()
    expect(deepLinkForRoute({ kind: 'chat' })).toBeNull()
    expect(deepLinkForRoute({ kind: 'settings' })).toBeNull()
    expect(
      deepLinkForRoute({
        kind: 'note',
        path: 'notes/a.md',
        fragment: { kind: 'blockPosition', ordinal: 1, expectedText: 'Target' },
      }),
    ).toBeNull()
    expect(
      deepLinkForRoute({
        kind: 'note',
        path: 'notes/a.md',
        fragment: { kind: 'wikiEmbedPosition', ordinal: 1, expectedTarget: 'Plan#^alpha' },
      }),
    ).toBeNull()
  })
})

describe('noteDeepLink', () => {
  it('percent-encodes the target and round-trips through the parser', () => {
    const url = noteDeepLink('Project X')
    expect(url).toBe('reflect://note/Project%20X')
    expect(parseDeepLink(url)).toEqual({ kind: 'openNote', target: 'Project X', fragment: null })
  })

  it('keeps an encoded hash in the note target separate from its fragment', () => {
    const url = noteDeepLink('Project#Plan', { kind: 'block', id: 'alpha' })
    expect(url).toBe('reflect://note/Project%23Plan#^alpha')
    expect(parseDeepLink(url)).toEqual({
      kind: 'openNote',
      target: 'Project#Plan',
      fragment: { kind: 'block', id: 'alpha' },
    })
  })
})

describe('dailyDeepLink', () => {
  it('addresses the daily route', () => {
    expect(parseDeepLink(dailyDeepLink('2026-01-31'))).toEqual({
      kind: 'navigate',
      route: { kind: 'daily', date: '2026-01-31' },
    })
  })

  it('round-trips an encoded heading fragment', () => {
    expect(
      parseDeepLink(dailyDeepLink('2026-01-31', { kind: 'heading', value: 'Plan & Review' })),
    ).toEqual({
      kind: 'navigate',
      route: {
        kind: 'daily',
        date: '2026-01-31',
        fragment: { kind: 'heading', value: 'Plan & Review' },
      },
    })
  })
})
