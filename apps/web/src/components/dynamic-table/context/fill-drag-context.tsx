// apps/web/src/components/dynamic-table/context/fill-drag-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'

export interface FillDragApi {
  beginFillDrag: (pointerId: number, pointerX: number, pointerY: number) => void
}

const FillDragContext = createContext<FillDragApi | null>(null)

interface FillDragProviderProps {
  children: ReactNode
  value: FillDragApi
}

/**
 * Exposes `beginFillDrag` from useFillDrag to the FillHandle component
 * without prop-drilling through the overlay.
 */
export function FillDragProvider({ children, value }: FillDragProviderProps) {
  return <FillDragContext.Provider value={value}>{children}</FillDragContext.Provider>
}

export function useFillDragContext(): FillDragApi | null {
  return useContext(FillDragContext)
}
