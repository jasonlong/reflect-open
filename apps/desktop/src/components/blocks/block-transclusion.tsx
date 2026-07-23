import { useCallback, useState, type ReactElement } from 'react'
import { MarkdownView, type WikiBlockEmbedRenderProps } from '@meowdown/react'
import type { ParsedWikiEmbed, WikiEmbedResolution } from '@meowdown/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { BlockPlaces } from '@/components/blocks/block-places'
import {
  useBlockTransclusion,
  type BlockTransclusionContext,
  type BlockTransclusionState,
  type ResolvedBlockTransclusion,
} from '@/hooks/use-block-transclusion'
import { cn } from '@/lib/utils'

export interface BlockTransclusionProps extends BlockTransclusionContext {
  readonly target: string
  readonly interactive?: boolean
  readonly onOpenSource?: (path: string, blockId: string) => void
}

/** Synchronous Meowdown classifier; exact-first resolution remains async in the component. */
export function resolveReflectWikiEmbed(embed: ParsedWikiEmbed): WikiEmbedResolution | undefined {
  return /#\^[A-Za-z0-9-]{1,64}$/.test(embed.target) ? { kind: 'block' } : undefined
}

function unavailableLabel(state: Exclude<BlockTransclusionState, ResolvedBlockTransclusion>): string {
  switch (state.kind) {
    case 'loading': return 'Loading referenced block…'
    case 'cycle': return 'Nested block reference'
    case 'ambiguousBlock': return 'Referenced block is ambiguous'
    case 'error': return 'Referenced block is unavailable'
    case 'missingNote': return 'Referenced note is unavailable'
    case 'missingBlock': return 'Referenced block is unavailable'
  }
}

function ResolvedTransclusion({
  state,
  depth,
  interactive,
  onOpenSource,
}: {
  readonly state: ResolvedBlockTransclusion
  readonly depth: number
  readonly interactive: boolean
  readonly onOpenSource?: (path: string, blockId: string) => void
}): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const context = [...state.breadcrumbs, state.noteTitle].reverse().join(' · ')
  const nestedRenderer = useCallback(
    (props: WikiBlockEmbedRenderProps) => (
      <BlockTransclusion
        target={props.target}
        interactive={false}
        visitedAddresses={state.visitedAddresses}
        depth={depth + 1}
        {...(onOpenSource === undefined ? {} : { onOpenSource })}
      />
    ),
    [depth, onOpenSource, state.visitedAddresses],
  )

  return (
    <div
      className={cn(
        'group/transclusion relative border-l border-transparent pl-3 transition-colors',
        'hover:border-border focus-within:border-border',
      )}
      aria-label={`Referenced from ${state.noteTitle}: ${state.text}`}
    >
      <div className="absolute -left-2 top-0 z-10 flex items-center gap-0.5 opacity-50 transition-opacity group-hover/transclusion:opacity-100 group-focus-within/transclusion:opacity-100">
        <BlockPlaces path={state.path} blockId={state.blockId} />
        <button
          type="button"
          className="rounded-sm p-0.5 text-text-muted hover:text-text"
          aria-label={collapsed ? 'Expand transclusion' : 'Collapse transclusion'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>
      <button
        type="button"
        className="mb-1 hidden max-w-full truncate text-left text-[11px] text-text-muted hover:text-text group-hover/transclusion:block group-focus-within/transclusion:block"
        aria-label={`Open source in ${state.noteTitle}`}
        onClick={() => onOpenSource?.(state.path, state.blockId)}
        disabled={!interactive || onOpenSource === undefined}
      >
        {context}
      </button>
      {!collapsed && (
        <MarkdownView
          markdown={state.markdown}
          markMode="hide"
          interactive={false}
          expandCollapsed
          resolveWikiEmbed={resolveReflectWikiEmbed}
          renderWikiBlockEmbed={nestedRenderer}
          className="reflect-editor"
        />
      )}
    </div>
  )
}

/** Read-only, live rendering of one source-backed list block. */
export function BlockTransclusion({
  target,
  visitedAddresses,
  depth = 0,
  interactive = true,
  onOpenSource,
}: BlockTransclusionProps): ReactElement {
  const state = useBlockTransclusion(target, {
    depth,
    ...(visitedAddresses === undefined ? {} : { visitedAddresses }),
  })
  if (state.kind === 'resolved') {
    return (
      <ResolvedTransclusion
        state={state}
        depth={depth}
        interactive={interactive}
        {...(onOpenSource === undefined ? {} : { onOpenSource })}
      />
    )
  }
  return (
    <div className="min-h-6 border-l border-border/60 pl-3 text-sm text-text-muted">
      {unavailableLabel(state)}
    </div>
  )
}
