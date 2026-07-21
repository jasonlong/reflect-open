import { splitFrontmatter } from './frontmatter'
import { parseBody } from './grammar'
import type { Span } from './model'
import { isWikiNodeName } from './wiki-nodes'

/** A plain-text mention that can be upgraded to a wiki link. */
export interface SuggestedBacklinkMention extends Span {
  /** Exact display text currently present in the source. */
  readonly text: string
  /** Canonical wiki-link target to write around the mention. */
  readonly target: string
}

/** The source changed after a suggestion was read, so applying it is unsafe. */
export class SuggestedBacklinkStaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SuggestedBacklinkStaleError'
  }
}

const WORD_CHARACTER_RE = /[\p{L}\p{N}_]/u
const RESERVED_WIKI_TEXT_RE = /[[\]|\\\r\n]/u
const EXCLUDED_NODE_NAMES = new Set([
  'Autolink',
  'CodeBlock',
  'FencedCode',
  'HTMLBlock',
  'Image',
  'InlineCode',
  'InlineHTML',
  'Link',
])

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER_RE.test(character)
}

function isWholePhrase(body: string, from: number, to: number, phrase: string): boolean {
  const first = phrase[0]
  const last = phrase.at(-1)
  return (
    (!isWordCharacter(first) || !isWordCharacter(body[from - 1])) &&
    (!isWordCharacter(last) || !isWordCharacter(body[to]))
  )
}

function excludedRanges(body: string): Span[] {
  const ranges: Span[] = []
  const tree = parseBody(body)
  tree.iterate({
    enter(node) {
      if (EXCLUDED_NODE_NAMES.has(node.name) || isWikiNodeName(node.name)) {
        ranges.push({ from: node.from, to: node.to })
        return false
      }
      return true
    },
  })

  // A note's first H1 is usually its title. Turning a mention there into a
  // link would rename the source note as a side effect, unlike V1 where the
  // subject lived outside the document, so suggestions never touch it.
  for (let child = tree.topNode.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === 'ATXHeading1' || child.name === 'SetextHeading1') {
      ranges.push({ from: child.from, to: child.to })
      break
    }
  }
  return ranges.sort((left, right) => left.from - right.from)
}

function overlaps(ranges: readonly Span[], from: number, to: number): boolean {
  return ranges.some((range) => range.from < to && range.to > from)
}

function escapedLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find the earliest unlinked, reader-visible mention of any target spelling.
 * Longer spellings win at the same offset (`Ada Lovelace` before `Ada`). Code,
 * existing links, HTML, Markdown links, frontmatter, and the source title are
 * excluded so accepting a suggestion is always a valid minimal Markdown edit.
 */
export function findSuggestedBacklinkMention(
  source: string,
  spellings: readonly string[],
  target: string,
): SuggestedBacklinkMention | null {
  const { body, bodyOffset } = splitFrontmatter(source)
  const ranges = excludedRanges(body)
  const matches: SuggestedBacklinkMention[] = []
  const uniqueSpellings = [...new Set(spellings.map((spelling) => spelling.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)

  for (const spelling of uniqueSpellings) {
    const expression = new RegExp(escapedLiteral(spelling), 'giu')
    for (const match of body.matchAll(expression)) {
      const from = match.index
      const text = match[0]
      const to = from + text.length
      if (!overlaps(ranges, from, to) && isWholePhrase(body, from, to, spelling)) {
        matches.push({ from: from + bodyOffset, to: to + bodyOffset, text, target })
      }
    }
  }

  matches.sort((left, right) => left.from - right.from || right.text.length - left.text.length)
  return matches[0] ?? null
}

/**
 * Upgrade one previously suggested plain-text mention to a wiki link. The
 * source coordinates and parse context are revalidated before the splice; a
 * stale row refuses rather than linking changed text or syntax. Display casing
 * is preserved through an alias when it differs from the canonical target.
 */
export function addSuggestedBacklink(
  source: string,
  mention: SuggestedBacklinkMention,
): string {
  const current = findSuggestedBacklinkMention(source, [mention.text], mention.target)
  if (
    current === null ||
    current.from !== mention.from ||
    current.to !== mention.to ||
    source.slice(mention.from, mention.to) !== mention.text
  ) {
    throw new SuggestedBacklinkStaleError('suggested backlink no longer matches the note')
  }
  if (
    mention.target.trim() === '' ||
    RESERVED_WIKI_TEXT_RE.test(mention.target) ||
    RESERVED_WIKI_TEXT_RE.test(mention.text)
  ) {
    throw new SuggestedBacklinkStaleError('suggested backlink cannot be represented safely')
  }
  const address =
    mention.text === mention.target ? mention.target : `${mention.target}|${mention.text}`
  return source.slice(0, mention.from) + `[[${address}]]` + source.slice(mention.to)
}
