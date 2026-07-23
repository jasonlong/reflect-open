import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'

export type BlockPickerIntent = 'reference' | 'embed'

export interface BlockPickerOpenOptions {
  readonly replaceEmptyBlock?: boolean
}

interface BlockPickerContextValue {
  readonly open: boolean
  readonly intent: BlockPickerIntent
  readonly replaceEmptyBlock: boolean
  readonly openBlockPicker: (
    intent?: BlockPickerIntent,
    options?: BlockPickerOpenOptions,
  ) => void
  readonly closeBlockPicker: () => void
}

const BlockPickerContext = createContext<BlockPickerContextValue | null>(null)

/** Workspace-owned state for the shared reference/embed block picker. */
export function BlockPickerProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<{
    open: boolean
    intent: BlockPickerIntent
    replaceEmptyBlock: boolean
  }>({ open: false, intent: 'reference', replaceEmptyBlock: false })
  const openBlockPicker = useCallback(
    (intent: BlockPickerIntent = 'reference', options: BlockPickerOpenOptions = {}) => {
      setState({
        open: true,
        intent,
        replaceEmptyBlock: options.replaceEmptyBlock ?? false,
      })
    },
    [],
  )
  const closeBlockPicker = useCallback(() => {
    setState((current) => ({ ...current, open: false }))
  }, [])
  const value = useMemo(
    () => ({ ...state, openBlockPicker, closeBlockPicker }),
    [state, openBlockPicker, closeBlockPicker],
  )
  return <BlockPickerContext.Provider value={value}>{children}</BlockPickerContext.Provider>
}

export function useBlockPicker(): BlockPickerContextValue {
  const context = useContext(BlockPickerContext)
  if (context === null) {
    throw new Error('useBlockPicker must be used within a BlockPickerProvider')
  }
  return context
}
