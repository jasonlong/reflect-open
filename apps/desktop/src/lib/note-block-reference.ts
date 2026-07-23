import {
  ensureBlockId,
  errorMessage,
  newBlockId,
  parseNote,
  readNote,
  writeNote,
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
const blockAddressWrites = new Map<string, Promise<void>>()

export interface EnsureBlockAddressInput {
  readonly notePath: string
  readonly locator: { readonly ordinal: number; readonly expectedText: string }
  readonly indexedBlockId: string | null
  readonly generation: number
}

export interface EnsuredBlockAddress {
  readonly id: string
  readonly noteAddress: string
  readonly blockText: string
}

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
export function formatBlockAddressReference(address: {
  readonly noteAddress: string
  readonly id: string
  readonly blockText: string
}): string {
  const label = blockReferenceLabel(address.blockText, address.noteAddress)
  return `[[${address.noteAddress}#^${address.id}|${label}]]`
}

export function formatBlockReference(address: ActiveBlockAddress): string {
  return formatBlockAddressReference({
    noteAddress: wikiLinkTargetForTitle(address.noteTitle),
    id: address.id,
    blockText: address.blockText,
  })
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

function serializeBlockWrite<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = blockAddressWrites.get(path) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(operation)
  blockAddressWrites.set(path, result.then(() => {}, () => {}))
  return result
}

/** Ensure an indexed block locator has a durable address through its current owner. */
export function ensureBlockAddress(input: EnsureBlockAddressInput): Promise<EnsuredBlockAddress> {
  return serializeBlockWrite(input.notePath, async () => {
    const session = openSession(input.notePath)
    const editor = noteEditorHandleFor(input.notePath)
    if (session !== null) {
      if (editor === null || !session.canCommitEditorChange()) {
        throw new Error('The source note is open but cannot save a block reference right now.')
      }
      const current = editor.getMarkdown()
      const edit = ensureBlockId(current, input.locator, input.indexedBlockId ?? undefined)
      if (edit.kind === 'assigned' && !editor.setBlockId(input.locator, edit.id)) {
        throw new Error('The selected block changed before it could be addressed.')
      }
      await session.flush()
      if (session.isDirty()) {
        throw new Error('The block reference could not be saved.')
      }
      const parsed = parseNote({ path: input.notePath, source: session.content() })
      return {
        id: edit.id,
        noteAddress: wikiLinkTargetForTitle(parsed.title),
        blockText: input.locator.expectedText,
      }
    }

    if (editor !== null) {
      throw new Error('The source editor has no owning note session.')
    }
    const source = await readNote(input.notePath)
    const edit = ensureBlockId(source, input.locator, input.indexedBlockId ?? undefined)
    if (edit.kind === 'assigned') {
      await writeNote(input.notePath, edit.source, input.generation)
    }
    const parsed = parseNote({ path: input.notePath, source: edit.source })
    return {
      id: edit.id,
      noteAddress: wikiLinkTargetForTitle(parsed.title),
      blockText: input.locator.expectedText,
    }
  })
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
