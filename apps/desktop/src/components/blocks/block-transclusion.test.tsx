import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import type { BlockTransclusionState } from '@/hooks/use-block-transclusion'
import { BlockTransclusion, resolveReflectWikiEmbed } from './block-transclusion'

const useBlockTransclusion = vi.hoisted(() => vi.fn())
vi.mock('./block-places', () => ({
  BlockPlaces: () => <button type="button">Appears in 1 place</button>,
}))
vi.mock('@/hooks/use-block-transclusion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-block-transclusion')>()),
  useBlockTransclusion,
}))

const resolved: BlockTransclusionState = {
  kind: 'resolved',
  path: 'notes/plan.md',
  blockId: 'secret-id',
  noteTitle: 'Plan',
  text: 'Make it work',
  markdown: '- Make it **work**\n  - Child',
  breadcrumbs: ['Architecture'],
  visitedAddresses: new Set(['notes/plan.md#^secret-id']),
}

beforeEach(() => useBlockTransclusion.mockReset().mockReturnValue(resolved))
afterEach(cleanup)

describe('BlockTransclusion', () => {
  it('renders native passive Markdown without exposing its technical ID', async () => {
    const view = await render(<BlockTransclusion target="Plan#^secret-id" />)
    await expect.element(view.getByText(/Make it/)).toBeVisible()
    expect(view.container.textContent).not.toContain('secret-id')
    expect(
      view.container.querySelector('button[aria-label="Open source in Plan"]'),
    ).not.toBeNull()
    expect(view.container.querySelector('.reflect-editor')).not.toBeNull()
  })

  it('opens the source and keeps collapse state local', async () => {
    const open = vi.fn()
    const view = await render(<BlockTransclusion target="Plan#^secret-id" onOpenSource={open} />)
    const sourceButton = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open source in Plan"]',
    )
    expect(sourceButton).not.toBeNull()
    sourceButton?.click()
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith('notes/plan.md', 'secret-id'))

    await view.getByRole('button', { name: 'Collapse transclusion' }).click()
    expect(view.container.textContent).not.toContain('Make it')
    await expect.element(view.getByRole('button', { name: 'Expand transclusion' })).toBeVisible()
  })

  it.each([
    ['loading', 'Loading referenced block…'],
    ['missingNote', 'Referenced note is unavailable'],
    ['missingBlock', 'Referenced block is unavailable'],
    ['ambiguousBlock', 'Referenced block is ambiguous'],
    ['cycle', 'Nested block reference'],
    ['error', 'Referenced block is unavailable'],
  ] as const)('renders a compact %s state', async (kind, label) => {
    useBlockTransclusion.mockReturnValue({ kind, target: 'Plan#^secret-id' })
    const view = await render(<BlockTransclusion target="Plan#^secret-id" />)
    expect(view.container.textContent).toContain(label)
    expect(view.container.textContent).not.toContain('secret-id')
  })
})

describe('resolveReflectWikiEmbed', () => {
  it('claims only portable block fragments', () => {
    expect(resolveReflectWikiEmbed({
      target: 'Plan#^alpha', display: '', width: null, height: null,
    })).toEqual({ kind: 'block' })
    expect(resolveReflectWikiEmbed({
      target: 'Plan#Heading', display: '', width: null, height: null,
    })).toBeUndefined()
  })
})
