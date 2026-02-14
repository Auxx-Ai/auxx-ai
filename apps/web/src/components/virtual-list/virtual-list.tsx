// apps/web/src/components/virtual-list/virtual-list.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual'
import { type CSSProperties, createContext, type ReactNode, useContext, useRef } from 'react'

/**
 * Context value for the VirtualList component
 */
interface VirtualListContextValue<T = any> {
  items: T[]
  selectedItems: Set<string>
  searchQuery: string
  isLoading: boolean
  hasMore: boolean
  virtualizer?: ReturnType<typeof useVirtualizer>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  onSelectionChange?: (id: string, selected: boolean) => void
  onSelectAll?: (selected: boolean) => void
  onSearch?: (query: string) => void
  onLoadMore?: () => void
}

const VirtualListContext = createContext<VirtualListContextValue | null>(null)

/**
 * Hook to access the VirtualList context
 */
export const useVirtualListContext = <T,>() => {
  const context = useContext(VirtualListContext) as VirtualListContextValue<T>
  if (!context) {
    throw new Error('useVirtualListContext must be used within VirtualList')
  }
  return context
}

/**
 * Props for the VirtualList component
 */
export interface VirtualListProps<T> {
  items: T[]
  selectedItems?: Set<string>
  searchQuery?: string
  isLoading?: boolean
  hasMore?: boolean
  onSelectionChange?: (id: string, selected: boolean) => void
  onSelectAll?: (selected: boolean) => void
  onSearch?: (query: string) => void
  onLoadMore?: () => void
  className?: string
  children: ReactNode
  // Virtualizer options
  estimateSize?: number
  overscan?: number
  getItemKey?: (item: T, index: number) => string
}

/**
 * Main VirtualList component that provides context and virtualization
 */
export function VirtualList<T>({
  items,
  selectedItems = new Set(),
  searchQuery = '',
  isLoading = false,
  hasMore = false,
  onSelectionChange,
  onSelectAll,
  onSearch,
  onLoadMore,
  className,
  children,
  estimateSize = 120,
  overscan = 5,
  getItemKey,
}: VirtualListProps<T>) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: getItemKey ? (index) => getItemKey(items[index]!, index) : undefined,
  })

  const contextValue: VirtualListContextValue<T> = {
    items,
    selectedItems,
    searchQuery,
    isLoading,
    hasMore,
    virtualizer,
    scrollContainerRef,
    onSelectionChange,
    onSelectAll,
    onSearch,
    onLoadMore,
  }

  return (
    <VirtualListContext.Provider value={contextValue}>
      <div
        data-slot='virtual-list'
        className={cn('flex flex-col min-h-0 overflow-y-auto flex-1', className)}>
        {children}
      </div>
    </VirtualListContext.Provider>
  )
}
