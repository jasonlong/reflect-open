import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBlockEmbedPlaces, type BlockEmbedPlace } from '@reflect/core'
import { Repeat2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

interface BlockPlacesProps {
  readonly path: string
  readonly blockId: string
}

function placeContext(place: BlockEmbedPlace): string {
  return place.breadcrumbs.length === 0
    ? place.noteTitle
    : `${place.noteTitle} · ${place.breadcrumbs.join(' · ')}`
}

/** Compact source/transclusion occurrence dialog for one uniquely addressed block. */
export function BlockPlaces({ path, blockId }: BlockPlacesProps): ReactElement {
  const [open, setOpen] = useState(false)
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const { data, isPending } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'block-places', path, blockId],
    queryFn: () => getBlockEmbedPlaces(path, blockId),
    enabled: graph !== null,
  })
  const total = data?.total ?? 1

  const navigateTo = (place: BlockEmbedPlace): void => {
    setOpen(false)
    if (place.kind === 'source') {
      navigate(routeForPath(place.path, { kind: 'block', id: blockId }))
      return
    }
    navigate(routeForPath(place.path, {
      kind: 'wikiEmbedPosition',
      ordinal: place.embedOrdinal,
      expectedTarget: place.expectedTarget,
    }))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Appears in ${total} ${total === 1 ? 'place' : 'places'}`}
        onClick={() => setOpen(true)}
      >
        <Repeat2 className="size-3" aria-hidden="true" />
        {total > 1 ? <span className="text-[10px]">{total}</span> : null}
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Appears in {total} {total === 1 ? 'place' : 'places'}</DialogTitle>
          <DialogDescription>Source and resolved read-only transclusions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {isPending ? <div className="px-2 py-2 text-sm text-text-muted">Loading places…</div> : null}
          {data?.places.map((place, index) => (
            <button
              key={`${place.kind}:${place.path}:${
                place.kind === 'transclusion' ? place.embedOrdinal : index
              }`}
              type="button"
              className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => navigateTo(place)}
            >
              <span className="w-20 shrink-0 text-xs text-text-muted">
                {place.kind === 'source' ? 'Source' : 'Transclusion'}
              </span>
              <span className="min-w-0 truncate text-sm">{placeContext(place)}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
