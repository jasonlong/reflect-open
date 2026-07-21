import {
  addSuggestedBacklink,
  readNote,
  writeNote,
  type SuggestedBacklink,
  type SuggestedBacklinkMention,
} from '@reflect/core'
import { openSession } from '@/editor/open-documents'

/** An open source note cannot safely accept the suggestion right now. */
export class SuggestedBacklinkBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SuggestedBacklinkBusyError'
  }
}

const writeChains = new Map<string, Promise<unknown>>()

function serializeByPath<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeChains.get(path) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  const settled = result.then(
    () => {},
    () => {},
  )
  writeChains.set(path, settled)
  void settled.then(() => {
    if (writeChains.get(path) === settled) {
      writeChains.delete(path)
    }
  })
  return result
}

/**
 * Accept one suggested backlink without clobbering an open editor. Open source
 * notes are edited through their live session so unsaved text survives; closed
 * notes use a generation-pinned read/modify/write. The core splice revalidates
 * the mention either way and refuses stale suggestions.
 */
export function acceptSuggestedBacklink(
  suggestion: SuggestedBacklink,
  generation: number,
): Promise<void> {
  return serializeByPath(suggestion.sourcePath, async () => {
    const mention: SuggestedBacklinkMention = {
      from: suggestion.from,
      to: suggestion.to,
      text: suggestion.text,
      target: suggestion.target,
    }
    const session = openSession(suggestion.sourcePath)
    if (session !== null) {
      if (await session.commitSuggestedBacklink(mention)) {
        return
      }
      throw new SuggestedBacklinkBusyError(
        'This note can’t be updated right now — try again in a moment.',
      )
    }
    const source = await readNote(suggestion.sourcePath)
    await writeNote(
      suggestion.sourcePath,
      addSuggestedBacklink(source, mention),
      generation,
    )
  })
}
