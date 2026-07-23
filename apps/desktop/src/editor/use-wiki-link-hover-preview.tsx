import { useCallback, type ReactNode } from 'react'
import type { WikilinkHoverHit } from '@meowdown/core'
import {
  getBlockById,
  getNote,
  parseWikiAddressCandidates,
  resolveExistingWikiTarget,
  resolveWikiAddress,
  splitFrontmatter,
  type BlockProjection,
  type DateFormat,
} from '@reflect/core'
import { WikiLinkHoverPreview } from '@/components/wiki-link-hover-preview'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'

interface WikiLinkHoverPreviewOptions {
  generation: number | null
  graphKey: string | null
  dateFormat: DateFormat
  resolveImageUrl: (src: string) => string | null
  resolveAssetOpenPath: (src: string) => string | null
}

function isSvgAsset(path: string): boolean {
  return path.toLowerCase().endsWith('.svg')
}

function BlockHoverPreview({
  block,
  noteTitle,
}: {
  block: BlockProjection
  noteTitle: string
}): ReactNode {
  const context = [...block.breadcrumbs, noteTitle].reverse().join(' · ')
  return (
    <div className="px-3.5 py-3 text-xs" data-testid="wiki-link-block-hover-preview">
      <div className="mb-1 text-text-muted">{context}</div>
      <div className="leading-relaxed text-popover-foreground">{block.text}</div>
    </div>
  )
}

function UnavailableBlockHoverPreview(): ReactNode {
  return (
    <div className="px-3.5 py-3 text-xs text-text-muted" data-testid="wiki-link-block-unavailable">
      Block unavailable
    </div>
  )
}

function previewRasterUrl(url: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}reflect-preview=raster`
}

/**
 * Build the async body resolver for Meowdown's editor-scoped wiki-link hover
 * card. The whole preview is decided inside the returned promise: an existing
 * target resolves to a passive snapshot body; missing, ambiguous, unavailable,
 * and failed targets resolve to `null`, which renders no card. Failures are
 * swallowed into `null` rather than rejected: transient read errors (an iCloud
 * eviction, a graph switch) are expected and should not log as errors.
 */
export function useWikiLinkHoverPreview({
  generation,
  graphKey,
  dateFormat,
  resolveImageUrl,
  resolveAssetOpenPath,
}: WikiLinkHoverPreviewOptions): (hit: WikilinkHoverHit) => Promise<ReactNode> {
  const resolvePreviewImageUrl = useCallback(
    (source: string): string | null => {
      const assetPath = resolveAssetOpenPath(source)
      // SVG can contain external subresource references. The filename check
      // avoids an unnecessary request; the query also makes the asset protocol
      // enforce a sniffed raster MIME allowlist, so renamed SVG bytes cannot
      // bypass the passive card's no-network boundary.
      if (assetPath === null || isSvgAsset(assetPath)) {
        return null
      }
      const url = resolveImageUrl(assetPath)
      return url === null ? null : previewRasterUrl(url)
    },
    [resolveAssetOpenPath, resolveImageUrl],
  )

  return useCallback(
    async ({ target }: WikilinkHoverHit): Promise<ReactNode> => {
      if (generation === null || graphKey === null) {
        return null
      }
      try {
        const candidates = parseWikiAddressCandidates(target)
        if (candidates.fragmented !== null) {
          const address = await resolveWikiAddress(target)
          if (address.kind === 'block') {
            const [lookup, note] = await Promise.all([
              getBlockById(address.path, address.blockId),
              getNote(address.path),
            ])
            return lookup.kind === 'resolved' ? (
              <BlockHoverPreview
                block={lookup.block}
                noteTitle={note?.title ?? address.path}
              />
            ) : (
              <UnavailableBlockHoverPreview />
            )
          }
          if (
            address.kind === 'ambiguousBlock' ||
            (address.kind === 'missing' && address.fragmentKind === 'block')
          ) {
            return <UnavailableBlockHoverPreview />
          }
          if (address.kind === 'heading' || address.kind === 'note') {
            const source = await readExistingNoteSource(address.path, generation)
            return (
              <WikiLinkHoverPreview
                path={address.path}
                markdown={splitFrontmatter(source).body}
                dateFormat={dateFormat}
                resolveImageUrl={resolvePreviewImageUrl}
              />
            )
          }
        }

        const resolution = await resolveExistingWikiTarget(target, generation)
        if (resolution.kind !== 'resolved') {
          return null
        }
        const source = await readExistingNoteSource(resolution.path, generation)
        return (
          <WikiLinkHoverPreview
            path={resolution.path}
            markdown={splitFrontmatter(source).body}
            dateFormat={dateFormat}
            resolveImageUrl={resolvePreviewImageUrl}
          />
        )
      } catch {
        return null
      }
    },
    [dateFormat, generation, graphKey, resolvePreviewImageUrl],
  )
}
