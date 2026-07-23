/** One list block inspected through Reflect's editor boundary. */
export interface NoteEditorBlock {
  readonly kind: 'listItem'
  readonly id: string | null
  readonly ordinal: number
  readonly text: string
}

/** A stale-safe document-order locator for an indexed list block. */
export interface NoteBlockLocator {
  readonly ordinal: number
  readonly expectedText: string
}

/** A unique ID or verified locator accepted by block reveal. */
export type NoteBlockRevealTarget =
  | { readonly id: string }
  | { readonly ordinal: number; readonly expectedText: string }
