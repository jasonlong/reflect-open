import { isBlockId, type TextCaptureKind } from '@reflect/core'
import { isIsoDate } from '@/lib/dates'
import {
  DEEP_LINK_SCHEME,
  DEEP_LINK_TEXT_MAX_LENGTH,
  type DeepLink,
  type DurableNoteFragment,
} from '@/lib/deep-links/deep-link'

/**
 * Parse a `reflect://` URL into a {@link DeepLink}, or null for anything the
 * grammar doesn't name. Null — not a best-effort guess: a URL is untrusted
 * input from outside the app, so an unknown verb, a malformed date, an
 * over-long payload, or stray path segments all reject rather than "open
 * something close". The caller owns telling the user (toast), never crashing.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  const url = tryParseUrl(raw)
  if (url === null || url.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return null
  }
  // The verb rides in the URL's host position (`reflect://today`) — an opaque
  // host on a non-special scheme, which the WHATWG parser does *not* fold, so
  // lower-case it here. The argument is the path remainder.
  const argument = decodedPathRemainder(url)
  const fragment = decodedFragment(url)
  if (argument === null || fragment === undefined) {
    return null
  }
  switch (url.host.toLowerCase()) {
    case 'today':
      return argument === '' && fragment === null
        ? { kind: 'navigate', route: { kind: 'today' } }
        : null
    case 'tasks':
      return argument === '' && fragment === null
        ? { kind: 'navigate', route: { kind: 'tasks' } }
        : null
    case 'daily':
      return isIsoDate(argument)
        ? {
            kind: 'navigate',
            route: fragment === null
              ? { kind: 'daily', date: argument }
              : { kind: 'daily', date: argument, fragment },
          }
        : null
    case 'search': {
      const query = url.searchParams.get('q')
      return query !== null && argument === '' && fragment === null
        ? { kind: 'navigate', route: { kind: 'search', query } }
        : null
    }
    case 'note':
      return argument === '' ? null : { kind: 'openNote', target: argument, fragment }
    case 'append':
      return captureLink('append', url, argument)
    case 'task':
      return captureLink('task', url, argument)
    default:
      return null
  }
}

/**
 * Whether an href uses the app's `reflect:` scheme — the routing predicate
 * for links clicked *inside* the app, which must dispatch through the in-app
 * deep-link pipeline instead of the OS opener (the opener capability denies
 * the scheme, dev builds don't register it, and another installed flavor
 * could claim the OS round-trip). Scheme-only: true does not promise
 * {@link parseDeepLink} accepts the URL — a malformed link still dispatches,
 * so it fails on the status line like any other bad deep link.
 */
export function isDeepLinkUrl(href: string): boolean {
  return tryParseUrl(href)?.protocol === `${DEEP_LINK_SCHEME}:`
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * The path after the verb, percent-decoded — `''` when absent (a bare or
 * trailing-slash URL), null when the encoding itself is malformed. Raw
 * slashes are kept so a hand-written `reflect://note/notes/foo.md` addresses
 * the same note as the encoded form.
 */
function decodedPathRemainder(url: URL): string | null {
  const remainder = url.pathname.replace(/^\//, '')
  try {
    return decodeURIComponent(remainder)
  } catch {
    return null
  }
}

/** Decode a durable heading/block fragment; `undefined` means malformed. */
function decodedFragment(url: URL): DurableNoteFragment | null | undefined {
  if (url.hash === '') {
    return null
  }
  let value: string
  try {
    value = decodeURIComponent(url.hash.slice(1))
  } catch {
    return undefined
  }
  if (value.startsWith('^')) {
    const id = value.slice(1)
    return isBlockId(id) ? { kind: 'block', id } : undefined
  }
  return value.trim() === '' ? undefined : { kind: 'heading', value }
}

/**
 * A write link's payload: the `text` query parameter, whitespace-collapsed to
 * a single line. Newlines are folded rather than honored — a capture becomes
 * exactly one daily-note line, so a URL can never smuggle extra markdown
 * blocks (headings, frontmatter fences) into the graph.
 */
function captureLink(capture: TextCaptureKind, url: URL, argument: string): DeepLink | null {
  if (argument !== '' || url.hash !== '') {
    return null
  }
  const text = url.searchParams.get('text')?.replace(/\s+/g, ' ').trim() ?? ''
  if (text === '' || text.length > DEEP_LINK_TEXT_MAX_LENGTH) {
    return null
  }
  return { kind: 'capture', capture, text }
}
