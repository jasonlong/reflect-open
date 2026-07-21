import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '@/routing/router'
import { SuggestedBacklinksSection } from './suggested-backlinks-section'

const getSuggestedBacklinks = vi.hoisted(() => vi.fn())
const acceptSuggestedBacklink = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getSuggestedBacklinks,
  hasBridge: () => true,
}))
vi.mock('@/lib/suggested-backlink', () => ({ acceptSuggestedBacklink }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))

const suggestion = {
  sourcePath: 'daily/2026-07-01.md',
  sourceTitle: '2026-07-01',
  snippet: 'Called Mum about the trip.',
  from: 14,
  to: 17,
  text: 'Mum',
  target: 'Charlotte MacCaw',
}

function renderSection(path: string = 'notes/charlotte.md') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider>
        <SuggestedBacklinksSection path={path} />
      </RouterProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  getSuggestedBacklinks.mockReset().mockResolvedValue([])
  acceptSuggestedBacklink.mockReset().mockResolvedValue(undefined)
})

describe('SuggestedBacklinksSection', () => {
  it('stays hidden when no notes contain an unlinked mention', async () => {
    const view = renderSection()
    await waitFor(() =>
      expect(getSuggestedBacklinks).toHaveBeenCalledWith('notes/charlotte.md', 6),
    )
    expect(view.container.firstChild).toBeNull()
  })

  it('shows source context and accepts the exact suggestion', async () => {
    getSuggestedBacklinks.mockResolvedValue([suggestion])
    const view = renderSection()

    expect(await view.findByText('Suggested backlinks')).toBeDefined()
    expect(view.getByText('Called Mum about the trip.')).toBeDefined()
    await userEvent.click(
      view.getByRole('button', { name: 'Add backlink from 2026-07-01' }),
    )

    expect(acceptSuggestedBacklink).toHaveBeenCalledWith(suggestion, 7)
    await waitFor(() => expect(view.container.firstChild).toBeNull())
  })

  it('does not query or render suggestions for daily notes', async () => {
    const view = renderSection('daily/2026-07-01.md')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getSuggestedBacklinks).not.toHaveBeenCalled()
    expect(view.container.firstChild).toBeNull()
  })
})
