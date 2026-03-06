// packages/sdk/src/client/workflow/hooks/use-array-item.ts

'use client'

import { createContext, useContext } from 'react'

export interface ArrayItemContextValue {
  /** Zero-based index of this item in the array */
  index: number
  /** Whether this is the first item */
  isFirst: boolean
  /** Whether this is the last item */
  isLast: boolean
  /** Total number of items in the array */
  total: number
  /** Remove this item from the array */
  remove: () => void
}

export const ArrayItemContext = createContext<ArrayItemContextValue | null>(null)

/**
 * Access array item metadata when inside an ArrayInput template.
 *
 * @example
 * ```tsx
 * function MyItem() {
 *   const { index, isFirst, isLast, remove } = useArrayItem()
 *   return (
 *     <VarFieldGroup>
 *       <VarField title={`Item #${index + 1}`}>
 *         <StringInput name="value" />
 *       </VarField>
 *     </VarFieldGroup>
 *   )
 * }
 * ```
 */
export function useArrayItem(): ArrayItemContextValue {
  const ctx = useContext(ArrayItemContext)
  if (!ctx) {
    throw new Error('useArrayItem must be used within an ArrayInput')
  }
  return ctx
}
