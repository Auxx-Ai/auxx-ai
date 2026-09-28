// apps/web/src/components/dynamic-table/context/row-geometry-context.tsx
'use client'

import { createContext, useContext } from 'react'

/** Pixel top of each `rows[i]` in the body container; null outside a `VirtualTableBody`. */
const RowGeometryContext = createContext<readonly number[] | null>(null)

export const RowGeometryProvider = RowGeometryContext.Provider

export function useRowTops(): readonly number[] | null {
  return useContext(RowGeometryContext)
}
