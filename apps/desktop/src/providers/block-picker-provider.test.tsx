import { describe, expect, it } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { ReactNode } from 'react'
import { BlockPickerProvider, useBlockPicker } from './block-picker-provider'

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return <BlockPickerProvider>{children}</BlockPickerProvider>
}

describe('BlockPickerProvider', () => {
  it('opens reference intent by default and keeps embed intent internal', async () => {
    const { result, act } = await renderHook(useBlockPicker, { wrapper: Wrapper })
    await act(() => result.current.openBlockPicker())
    expect(result.current).toMatchObject({ open: true, intent: 'reference' })
    await act(() => result.current.closeBlockPicker())
    expect(result.current.open).toBe(false)
    await act(() => result.current.openBlockPicker('embed'))
    expect(result.current).toMatchObject({ open: true, intent: 'embed' })
  })
})
