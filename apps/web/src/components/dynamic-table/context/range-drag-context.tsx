// apps/web/src/components/dynamic-table/context/range-drag-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { RangeEndpoint } from '../types'

export interface RangeDragApi {
  beginDrag: (
    anchorEndpoint: RangeEndpoint,
    pointerId: number,
    pointerX: number,
    pointerY: number,
    options?: { extend?: boolean }
  ) => void
}

const RangeDragContext = createContext<RangeDragApi | null>(null)

interface RangeDragProviderProps {
  children: ReactNode
  value: RangeDragApi
}

/**
 * Exposes `beginDrag` from useRangeDrag to descendant cells without prop drilling.
 */
export function RangeDragProvider({ children, value }: RangeDragProviderProps) {
  return <RangeDragContext.Provider value={value}>{children}</RangeDragContext.Provider>
}

export function useRangeDragContext(): RangeDragApi | null {
  return useContext(RangeDragContext)
}
