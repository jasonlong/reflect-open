import type {
  AcceptPendingReplacementOptions,
  StartPendingReplacementOptions,
} from '@meowdown/core'
import type {
  NoteBlockLocator,
  NoteBlockRevealTarget,
  NoteEditorBlock,
} from '@/editor/note-editor-blocks'

/** Imperative surface for note switching, reload, commands, and save flushes. */
export interface NoteEditorHandle {
  /** Reconcile pending native input and serialize the current Markdown. */
  getMarkdown(): string
  /** Replace the document for a note switch or external reload. */
  setMarkdown(markdown: string): void
  /** Insert a parsed Markdown fragment as one undoable editor transaction. */
  insertMarkdown(markdown: string): void
  /** Insert a source-backed standalone block embed in one editor transaction. */
  insertBlockEmbed(source: string, replaceEmptyBlock?: boolean): boolean
  focus(): void
  /** Move the caret to a document edge and scroll it into view. */
  setSelection(position: 'start' | 'end'): void
  /** Return the current selection as Markdown-aware text. */
  getSelectedText(): string
  /** Open the selection AI menu when a non-empty selection exists. */
  openSelectionMenu(): void
  /** Stage a pending replacement over a range; false when the range is invalid. */
  startPendingReplacement(options: StartPendingReplacementOptions): boolean
  /** Append streamed text to the staged replacement preview. */
  appendPendingReplacementText(text: string): void
  /** Apply the staged replacement as one edit. */
  acceptPendingReplacement(options?: AcceptPendingReplacementOptions): void
  /** Clear the staged replacement without touching the document. */
  discardPendingReplacement(): void
  /** Inspect the single list item containing the current selection. */
  getActiveBlock(): NoteEditorBlock | null
  /** Assign an ID to the active list item as one undoable edit. */
  setActiveBlockId(id: string): boolean
  /** Assign an ID only when the indexed locator still matches. */
  setBlockId(target: NoteBlockLocator, id: string): boolean
  /** Reveal a heading by its rendered text. */
  revealHeading(heading: string): boolean
  /** Reveal a unique ID or stale-safe list-block locator. */
  revealBlock(target: NoteBlockRevealTarget): boolean
  /** Reveal a position-verified rendered block embed. */
  revealWikiEmbed(target: { readonly ordinal: number; readonly expectedTarget: string }): boolean
  /** Recompute syntax visibility after host-owned state changes. */
  refreshMarkdownRendering(): void
}
