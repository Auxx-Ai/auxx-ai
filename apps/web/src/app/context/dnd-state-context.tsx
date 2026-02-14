// src/app/context/dnd-state-context.tsx
'use client'

import type { Active } from '@dnd-kit/core'
import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

interface DndState {
  activeDndItem: Active | null
}

// Context for exposing DND state down the tree
const DndStateContext = createContext<DndState | null>(null)

interface DndStateProviderProps {
  children: ReactNode
  // Pass state setters if needed, but often just passing the state is enough
  activeDndItem: Active | null
}

// Provider component - usually rendered by the common ancestor where DndContext lives
export function DndStateProvider({ children, activeDndItem }: DndStateProviderProps) {
  const value = useMemo(() => ({ activeDndItem }), [activeDndItem])
  return <DndStateContext.Provider value={value}>{children}</DndStateContext.Provider>
}

// Hook for consuming DND state
export function useDndState(): DndState {
  const context = useContext(DndStateContext)
  if (context === null) {
    throw new Error('useDndState must be used within a DndStateProvider')
  }
  return context
}
