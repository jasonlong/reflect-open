import {
  errorMessage,
  newBlockId,
  parseNote,
  wikiLinkSafe,
  wikiLinkTargetForTitle,
} from '@reflect/core'
import { noteEditorHandleFor } from '@/editor/editor-handle-registry'
import { openSession } from '@/editor/open-documents'
import type { NoteEditorBlock } from '@/editor/note-editor'
import type { CommandContext } from '@/lib/commands/types'
import { deepLinkForNote } from '@/lib/note-deep-link'
import { startOperation } from '@/lib/operations'

const BLOCK_REFERENCE_LABEL_MAX_CODE_POINTS = 80

export interface ActiveBlockAddress {
  readonly path: string
  readonly id: string
  readonly noteTitle: string
  readonly blockText: string
  readonly generation: number
}

/** Human snapshot label for an app-authored block reference. */
export function blockReferenceLabel(blockText: string, noteTitle: string): string {
  const sanitized = wikiLinkSafe(blockText)
  const fallback = wikiLinkSafe(`Block in ${noteTitle}`)
  const label = sanitized === '' ? fallback : sanitized
  const codePoints = Array.from(label)
  return codePoints.length <= BLOCK_REFERENCE_LABEL_MAX_CODE_POINTS
    ? label
    : `${codePoints.slice(0, BLOCK_REFERENCE_LABEL_MAX_CODE_POINTS - 1).join('')}…`
}

/** Portable Markdown for a human-labelled block reference. */
export function formatBlockReference(address: ActiveBlockAddress): string {
  const noteTarget = wikiLinkTargetForTitle(address.noteTitle)
  const label = blockReferenceLabel(address.blockText, address.noteTitle)
  return `[[${noteTarget}#^${address.id}|${label}]]`
}

function uniqueCurrentId(block: NoteEditorBlock, markdown: string): boolean {
  if (block.id === null) {
    return false
  }
  const claims = parseNote({ path: '', source: markdown }).blocks.filter(
    (candidate) => candidate.id === block.id,
  )
  return claims.length === 1
}

/**
 * Ensure the active list item has a unique durable ID, then await its owning
 * session's landed write before returning an address.
 */
export async function ensureActiveBlockAddress(
  context: CommandContext,
): Promise<ActiveBlockAddress> {
  const path = context.notePath()
  const generation = context.generation()
  if (path === null || generation === null) {
    throw new Error('No writable note is active.')
  }
  const editor = noteEditorHandleFor(path)
  const session = openSession(path)
  if (editor === null || session === null) {
    throw new Error('The current note editor is not available.')
  }
  if (!session.canCommitEditorChange()) {
    throw new Error('The current note cannot save a block reference right now.')
  }

  const active = editor.getActiveBlock()
  if (active === null) {
    throw new Error('Place the cursor in a list item to copy a block reference.')
  }
  const markdown = editor.getMarkdown()
  let id = active.id
  if (id !== null) {
    if (!uniqueCurrentId(active, markdown)) {
      throw new Error('That block ID is duplicated in this note.')
    }
  } else {
    const existingIds = new Set(
      parseNote({ path, source: markdown }).blocks.flatMap((block) =>
        block.id === null ? [] : [block.id],
      ),
    )
    id = newBlockId(existingIds)
    if (!editor.setActiveBlockId(id)) {
      throw new Error('The active block changed before it could be addressed.')
    }
  }

  await session.flush()
  if (session.isDirty()) {
    throw new Error('The block reference could not be saved.')
  }
  const noteTitle = parseNote({ path, source: session.content() }).title
  return { path, id, noteTitle, blockText: active.text, generation }
}

async function copyBlockValue(
  context: CommandContext,
  successLabel: string,
  failureLabel: string,
  value: (address: ActiveBlockAddress) => Promise<string> | string,
): Promise<void> {
  try {
    const address = await ensureActiveBlockAddress(context)
    if (context.generation() !== address.generation) {
      throw new Error('The graph changed before the block reference could be copied.')
    }
    const text = await value(address)
    await navigator.clipboard.writeText(text)
    startOperation(successLabel).done()
  } catch (cause) {
    startOperation(failureLabel).fail(errorMessage(cause))
  }
}

/** Copy a portable, human-labelled Markdown reference to the active block. */
export function runCopyBlockReference(context: CommandContext): Promise<void> {
  return copyBlockValue(
    context,
    'Block reference copied',
    'Copying block reference',
    formatBlockReference,
  )
}

/** Copy a durable `reflect://` link to the active block. */
export function runCopyBlockDeepLink(context: CommandContext): Promise<void> {
  return copyBlockValue(
    context,
    'Block deep link copied',
    'Copying block deep link',
    (address) =>
      deepLinkForNote(address.path, address.generation, { kind: 'block', id: address.id }),
  )
}
