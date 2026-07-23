import { isBlockId, newBlockId } from './block-address'
import { parseNote } from './extract'

export interface BlockLocator {
  readonly ordinal: number
  readonly expectedText: string
}

export type EnsureBlockIdResult =
  | { readonly kind: 'existing'; readonly id: string; readonly source: string }
  | { readonly kind: 'assigned'; readonly id: string; readonly source: string }

/** A locator or ID no longer names exactly one safe block mutation. */
export class BlockLocatorStaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockLocatorStaleError'
  }
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Ensure the exact ordinal/text block has a unique ID without relocating it by text. */
export function ensureBlockId(
  source: string,
  locator: BlockLocator,
  proposedId?: string,
): EnsureBlockIdResult {
  const parsed = parseNote({ path: '', source })
  const block = parsed.blocks[locator.ordinal]
  if (block === undefined || normalizedText(block.text) !== normalizedText(locator.expectedText)) {
    throw new BlockLocatorStaleError('The selected block changed before it could be addressed.')
  }
  if (block.id !== null) {
    if (parsed.blocks.filter((candidate) => candidate.id === block.id).length !== 1) {
      throw new BlockLocatorStaleError('The selected block ID is ambiguous.')
    }
    return { kind: 'existing', id: block.id, source }
  }

  if (proposedId !== undefined && !isBlockId(proposedId)) {
    throw new BlockLocatorStaleError('The proposed block ID is invalid.')
  }
  const existingIds = new Set(parsed.blocks.flatMap((candidate) =>
    candidate.id === null ? [] : [candidate.id],
  ))
  const id = proposedId ?? newBlockId(existingIds)
  if (existingIds.has(id)) {
    throw new BlockLocatorStaleError('The proposed block ID is already in use.')
  }

  const firstNewline = source.indexOf('\n', block.leadFrom)
  const physicalEnd = firstNewline === -1 || firstNewline > block.leadTo
    ? block.leadTo
    : firstNewline
  const insertAt = physicalEnd > block.leadFrom && source[physicalEnd - 1] === '\r'
    ? physicalEnd - 1
    : physicalEnd
  return {
    kind: 'assigned',
    id,
    source: `${source.slice(0, insertAt)} ^${id}${source.slice(insertAt)}`,
  }
}
