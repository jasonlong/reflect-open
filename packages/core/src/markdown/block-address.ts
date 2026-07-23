const BLOCK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
const BLOCK_ID_LETTER_PATTERN = /[A-Za-z]/
const GENERATED_BLOCK_ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const GENERATED_BLOCK_ID_LENGTH = 8
const MAX_GENERATION_ATTEMPTS = 32

/** A heading or durable list-block fragment parsed from a wiki target. */
export type WikiFragment =
  | { readonly kind: 'heading'; readonly value: string }
  | { readonly kind: 'block'; readonly id: string }

/**
 * The exact note target and optional fragment fallback candidates for one wiki
 * address. Graph resolution decides which candidate wins.
 */
export interface WikiAddressCandidates {
  readonly exactTarget: string
  readonly fragmented: {
    readonly noteTarget: string
    readonly fragment: WikiFragment
  } | null
}

/** Whether `value` is a valid durable Markdown block identifier. */
export function isBlockId(value: string): boolean {
  return BLOCK_ID_PATTERN.test(value) && BLOCK_ID_LETTER_PATTERN.test(value)
}

/**
 * Parse candidates without consulting the graph. Consumers must try
 * `exactTarget` before the optional fragmented fallback so note titles
 * containing `#` continue to work.
 */
export function parseWikiAddressCandidates(target: string): WikiAddressCandidates {
  const exactTarget = target.trim()
  const blockSeparator = exactTarget.lastIndexOf('#^')
  if (blockSeparator !== -1) {
    const noteTarget = exactTarget.slice(0, blockSeparator).trim()
    const id = exactTarget.slice(blockSeparator + 2).trim()
    return {
      exactTarget,
      fragmented:
        noteTarget !== '' && isBlockId(id)
          ? { noteTarget, fragment: { kind: 'block', id } }
          : null,
    }
  }

  const headingSeparator = exactTarget.lastIndexOf('#')
  if (headingSeparator === -1) {
    return { exactTarget, fragmented: null }
  }
  const noteTarget = exactTarget.slice(0, headingSeparator).trim()
  const value = exactTarget.slice(headingSeparator + 1).trim()
  return {
    exactTarget,
    fragmented:
      noteTarget !== '' && value !== ''
        ? { noteTarget, fragment: { kind: 'heading', value } }
        : null,
  }
}

/**
 * Generate a cryptographically random, note-scoped block ID. Existing IDs are
 * retried and an impossible collision run fails loudly rather than weakening
 * identity with `Math.random`.
 */
export function newBlockId(existingIds: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const bytes = new Uint8Array(GENERATED_BLOCK_ID_LENGTH)
    crypto.getRandomValues(bytes)
    let id = ''
    for (const byte of bytes) {
      id += GENERATED_BLOCK_ID_ALPHABET[byte & 31]
    }
    if (isBlockId(id) && !existingIds.has(id)) {
      return id
    }
  }
  throw new Error('Unable to generate a unique block ID')
}
