import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchBlocks } from '@reflect/core'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { noteEditorHandleFor } from '@/editor/editor-handle-registry'
import type { NoteEditorHandle } from '@/editor/note-editor'
import type { CommandContext } from '@/lib/commands/types'
import {
  ensureBlockAddress,
  formatBlockAddressEmbed,
  formatBlockAddressReference,
} from '@/lib/note-block-reference'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { startOperation } from '@/lib/operations'
import { useBlockPicker } from '@/providers/block-picker-provider'
import { useGraph } from '@/providers/graph-provider'

interface BlockPickerProps {
  readonly context: CommandContext
}

interface Destination {
  readonly path: string
  readonly editor: NoteEditorHandle
}

function secondaryLabel(noteTitle: string, breadcrumbs: readonly string[]): string {
  const trail = breadcrumbs.length <= 3
    ? breadcrumbs
    : [breadcrumbs[0]!, '…', breadcrumbs.at(-1)!]
  return [noteTitle, ...trail].join(' · ')
}

/** Keyboard-first source block search and reference insertion surface. */
export function BlockPicker({ context }: BlockPickerProps): ReactElement | null {
  const { open, intent, replaceEmptyBlock, closeBlockPicker } = useBlockPicker()
  const { graph } = useGraph()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [capture, setCapture] = useState<{ open: boolean; destination: Destination | null }>({
    open: false,
    destination: null,
  })
  if (capture.open !== open) {
    const path = open ? context.notePath() : null
    const editor = path === null ? null : noteEditorHandleFor(path)
    setCapture({
      open,
      destination: path === null || editor === null ? null : { path, editor },
    })
    if (!open) {
      setQuery('')
      setPending(false)
    }
  }

  const { data, isPending, isError } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'blocks', query, capture.destination?.path],
    queryFn: () => searchBlocks(query, { currentPath: capture.destination?.path ?? null }),
    enabled: open && graph !== null,
  })

  if (!open) {
    return null
  }

  const select = async (result: NonNullable<typeof data>[number]): Promise<void> => {
    const destination = capture.destination
    const generation = context.generation()
    if (
      pending ||
      destination === null ||
      generation === null ||
      context.notePath() !== destination.path ||
      noteEditorHandleFor(destination.path) !== destination.editor
    ) {
      startOperation(intent === 'embed' ? 'Embedding block' : 'Inserting block reference').fail(
        'The destination editor is no longer available.',
      )
      return
    }
    setPending(true)
    try {
      const address = await ensureBlockAddress({
        notePath: result.path,
        locator: { ordinal: result.ordinal, expectedText: result.text },
        indexedBlockId: result.blockId,
        generation,
      })
      if (
        context.generation() !== generation ||
        context.notePath() !== destination.path ||
        noteEditorHandleFor(destination.path) !== destination.editor
      ) {
        throw new Error('The destination editor changed while the block was being addressed.')
      }
      if (intent === 'reference') {
        destination.editor.insertMarkdown(formatBlockAddressReference(address))
      } else if (
        !destination.editor.insertBlockEmbed(
          formatBlockAddressEmbed(address),
          replaceEmptyBlock,
        )
      ) {
        throw new Error('The block embed could not be inserted at the current position.')
      }
      closeBlockPicker()
      destination.editor.focus()
    } catch (cause) {
      const operation = intent === 'embed' ? 'Embedding block' : 'Inserting block reference'
      startOperation(operation).fail(
        cause instanceof Error ? cause.message : `The ${intent} could not be inserted.`,
      )
      setPending(false)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) {
          closeBlockPicker()
        }
      }}
      title={intent === 'embed' ? 'Embed block' : 'Insert block reference'}
      description={
        intent === 'embed'
          ? 'Search existing bullets and insert a read-only transclusion'
          : 'Search existing bullets and insert a reference'
      }
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search blocks…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isPending ? 'Searching blocks…' : isError ? 'Couldn’t search blocks' : 'No blocks found'}
          </CommandEmpty>
          <CommandGroup>
            {(data ?? []).map((result) => (
              <CommandItem
                key={`${result.path}:${result.ordinal}`}
                value={`${result.text} ${result.noteTitle} ${result.breadcrumbs.join(' ')}`}
                disabled={pending}
                onSelect={() => void select(result)}
              >
                <div className="min-w-0">
                  <div className="truncate">{result.text}</div>
                  <div className="truncate text-xs text-text-muted">
                    {secondaryLabel(result.noteTitle, result.breadcrumbs)}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
