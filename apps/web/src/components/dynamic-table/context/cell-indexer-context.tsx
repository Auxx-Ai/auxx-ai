// apps/web/src/components/dynamic-table/context/cell-indexer-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { CellIndexer } from '../hooks/use-cell-indexer'

const CellIndexerContext = createContext<CellIndexer | null>(null)

interface CellIndexerProviderProps {
  children: ReactNode
  value: CellIndexer
}

/**
 * Provider that exposes id↔index maps for the visible row/column set.
 * Cells subscribe via useCellIndexerContext to compute "am I inside the range?"
 * without needing the indexer hook themselves.
 */
export function CellIndexerProvider({ children, value }: CellIndexerProviderProps) {
  return <CellIndexerContext.Provider value={value}>{children}</CellIndexerContext.Provider>
}

export function useCellIndexerContext(): CellIndexer | null {
  return useContext(CellIndexerContext)
}
