import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { BlockPlaces } from './block-places'

const getBlockEmbedPlaces = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getBlockEmbedPlaces,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/graph' } }),
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

beforeEach(() => {
  navigate.mockReset()
  getBlockEmbedPlaces.mockReset().mockResolvedValue({
    total: 2,
    places: [
      { kind: 'source', path: 'notes/plan.md', noteTitle: 'Plan', breadcrumbs: [] },
      {
        kind: 'transclusion', path: 'notes/other.md', noteTitle: 'Other',
        breadcrumbs: ['Parent'], embedOrdinal: 3, expectedTarget: 'Plan#^alpha',
      },
    ],
  })
})

describe('BlockPlaces', () => {
  it('lists source and transclusions and navigates with verified fragments', async () => {
    await render(<BlockPlaces path="notes/plan.md" blockId="alpha" />, { wrapper: Wrapper })
    const placesButton = page.getByRole('button', { name: 'Appears in 2 places' })
    await expect.element(placesButton).toBeVisible()
    await placesButton.click()
    await expect.element(page.getByRole('heading', { name: 'Appears in 2 places' })).toBeVisible()
    await expect.element(page.getByText('Other · Parent')).toBeVisible()

    await page.getByText('Other · Parent').click()
    expect(navigate).toHaveBeenCalledWith({
      kind: 'note',
      path: 'notes/other.md',
      fragment: {
        kind: 'wikiEmbedPosition', ordinal: 3, expectedTarget: 'Plan#^alpha',
      },
    })
  })
})
