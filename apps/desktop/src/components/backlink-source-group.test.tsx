import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import type { BacklinkSource } from '@/lib/group-backlinks'
import { BacklinkSourceGroup } from './backlink-source-group'

vi.mock('@/components/backlink-snippet', () => ({
  BacklinkSnippet: ({ text }: { text: string }) => <div>{text}</div>,
}))

const SOURCE: BacklinkSource = {
  path: 'notes/source.md',
  title: 'Source Note',
  snippets: [],
}

function mount(
  onOpen: (path: string, event?: { metaKey: boolean }) => void,
  source: BacklinkSource = SOURCE,
  onRevealTarget = vi.fn(),
) {
  return render(
    <BacklinkSourceGroup
      source={source}
      first
      expanded={source.snippets.length > 0}
      onOpen={onOpen}
      onWikilinkClick={() => {}}
      resolveImageUrl={() => undefined}
      onRevealTarget={onRevealTarget}
    />,
  )
}

describe('BacklinkSourceGroup', () => {
  it('forwards the click event so ⌘-click can open a new window', async () => {
    const onOpen = vi.fn()
    await mount(onOpen)

    await page.getByRole('button', { name: 'Source Note' }).click({ modifiers: ['Meta'] })

    expect(onOpen).toHaveBeenCalledTimes(1)
    const [path, event] = onOpen.mock.calls[0]!
    expect(path).toBe('notes/source.md')
    expect(event?.metaKey).toBe(true)
  })

  it('renders human target metadata and reveals it without showing an ID', async () => {
    const onRevealTarget = vi.fn()
    const snippet = {
      key: 'source:1:block:secret-id',
      text: 'See [[Target#^secret-id]]',
      tasks: [],
      fragmentKind: 'block',
      fragmentValue: 'secret-id',
      blockAvailability: 'resolved' as const,
      targetBlockText: 'Keep Markdown',
    }
    await mount(
      vi.fn(),
      { ...SOURCE, snippets: [snippet] },
      onRevealTarget,
    )

    const label = page.getByRole('button', { name: 'to: Keep Markdown' })
    await expect.element(label).not.toHaveTextContent('secret-id')
    await label.click()
    expect(onRevealTarget).toHaveBeenCalledWith(snippet)
  })

  it('keeps unavailable block references visible', async () => {
    await mount(vi.fn(), {
      ...SOURCE,
      snippets: [
        {
          key: 'source:1:block:missing',
          text: 'See missing block',
          tasks: [],
          fragmentKind: 'block',
          fragmentValue: 'missing',
          blockAvailability: 'missing',
          targetBlockText: null,
        },
      ],
    })
    await expect.element(page.getByRole('button', { name: 'block unavailable' })).toBeVisible()
  })

  it('plain clicks arrive without the modifier', async () => {
    const onOpen = vi.fn()
    await mount(onOpen)

    await page.getByRole('button', { name: 'Source Note' }).click()

    const [, event] = onOpen.mock.calls[0]!
    expect(event?.metaKey).toBe(false)
  })
})
