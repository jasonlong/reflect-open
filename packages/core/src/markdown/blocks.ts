import type { SyntaxNode } from '@meowdown/markdown'
import { isBlockId } from './block-address'
import type { ParsedBlock, Span } from './model'
import { plainTextOfRange } from './plain-text'
import { listItemBreadcrumbs, listItemLeadTextblock } from './task-breadcrumbs'

interface BlockMarker {
  readonly id: string
  readonly marker: Span
  readonly cut: Span
}

interface BlockDraft {
  readonly item: SyntaxNode
  readonly lead: SyntaxNode
  readonly marker: BlockMarker | null
}

/** One duplicate ID and every block location that claims it. */
export interface DuplicateBlockId {
  readonly id: string
  readonly blocks: readonly {
    readonly ordinal: number
    readonly span: Span
  }[]
}

function markerForLead(body: string, lead: SyntaxNode): BlockMarker | null {
  const newline = body.indexOf('\n', lead.from)
  const physicalEnd = newline === -1 || newline > lead.to ? lead.to : newline
  const lineEnd = physicalEnd > lead.from && body[physicalEnd - 1] === '\r' ? physicalEnd - 1 : physicalEnd
  const line = body.slice(lead.from, lineEnd)
  const match = /([\t ]+)\^([A-Za-z0-9-]{1,64})[\t ]*$/.exec(line)
  if (match === null || !isBlockId(match[2]!)) {
    return null
  }
  const cutFrom = lead.from + match.index
  const markerFrom = cutFrom + match[1]!.length
  return {
    id: match[2]!,
    marker: { from: markerFrom, to: markerFrom + match[2]!.length + 1 },
    cut: { from: cutFrom, to: lineEnd },
  }
}

function withoutRanges(body: string, from: number, to: number, ranges: readonly Span[]): string {
  let markdown = body.slice(from, to)
  const contained = ranges
    .filter((range) => range.from >= from && range.to <= to)
    .sort((left, right) => right.from - left.from)
  for (const range of contained) {
    const relativeFrom = range.from - from
    const relativeTo = range.to - from
    markdown = markdown.slice(0, relativeFrom) + markdown.slice(relativeTo)
  }
  return markdown
}

/**
 * Extract referenceable list-item subtrees from parser nodes captured during
 * the canonical Markdown walk. All returned coordinates use whole-file UTF-16
 * offsets; `markerCuts` stay in body coordinates for plain-text extraction.
 */
export function extractListBlocks(input: {
  readonly body: string
  readonly bodyOffset: number
  readonly listItems: readonly SyntaxNode[]
  readonly cuts: readonly Span[]
  readonly literalRanges: readonly Span[]
}): { readonly blocks: ParsedBlock[]; readonly markerCuts: Span[] } {
  const { body, bodyOffset, listItems, cuts, literalRanges } = input
  const drafts: BlockDraft[] = []
  for (const item of listItems) {
    const lead = listItemLeadTextblock(item)
    if (lead !== null) {
      drafts.push({ item, lead, marker: markerForLead(body, lead) })
    }
  }

  const markerCuts = drafts.flatMap((draft) => (draft.marker === null ? [] : [draft.marker.cut]))
  const displayCuts = [...cuts, ...markerCuts]
  const displayLiteralRanges = [...literalRanges]
  const blocks = drafts.map<ParsedBlock>((draft, ordinal) => ({
    ordinal,
    kind: 'listItem',
    id: draft.marker?.id ?? null,
    markerSpan:
      draft.marker === null
        ? null
        : {
            from: draft.marker.marker.from + bodyOffset,
            to: draft.marker.marker.to + bodyOffset,
          },
    from: draft.item.from + bodyOffset,
    to: draft.item.to + bodyOffset,
    leadFrom: draft.lead.from + bodyOffset,
    leadTo: draft.lead.to + bodyOffset,
    text: plainTextOfRange(body, draft.lead.from, draft.lead.to, displayCuts, displayLiteralRanges),
    markdown: withoutRanges(body, draft.item.from, draft.item.to, markerCuts),
    breadcrumbs: listItemBreadcrumbs(body, draft.item, displayCuts, displayLiteralRanges),
  }))

  return { blocks, markerCuts }
}

/** Return duplicate IDs without making an externally edited note unreadable. */
export function findDuplicateBlockIds(blocks: readonly ParsedBlock[]): DuplicateBlockId[] {
  const claims = new Map<string, Array<{ ordinal: number; span: Span }>>()
  for (const block of blocks) {
    if (block.id === null) {
      continue
    }
    const locations = claims.get(block.id) ?? []
    locations.push({ ordinal: block.ordinal, span: { from: block.from, to: block.to } })
    claims.set(block.id, locations)
  }
  return [...claims]
    .filter(([, locations]) => locations.length > 1)
    .map(([id, locations]) => ({ id, blocks: locations }))
}
