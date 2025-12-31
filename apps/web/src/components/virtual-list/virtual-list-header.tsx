// apps/web/src/components/virtual-list/virtual-list-header.tsx
'use client'

import { type ReactNode } from 'react'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { InputSearch } from '@auxx/ui/components/input-search'
import { useVirtualListContext } from './virtual-list'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for the VirtualListHeader component
 */
interface VirtualListHeaderProps {
  children?: ReactNode
  className?: string
  showSelectAll?: boolean
  showSearch?: boolean
  searchPlaceholder?: string
  selectAllLabel?: string
}

/**
 * Header component for VirtualList with search and selection controls
 */
export function VirtualListHeader({
  children,
  className,
  showSelectAll = true,
  showSearch = true,
  searchPlaceholder = 'Search...',
  selectAllLabel = 'Select all',
}: VirtualListHeaderProps) {
  const { items, selectedItems, searchQuery, onSelectAll, onSearch } = useVirtualListContext()

  const isAllSelected = items.length > 0 && selectedItems.size === items.length

  return (
    <div
      className={cn(
        'sticky top-0 z-10 bg-background/50 backdrop-blur-sm space-y-3 py-2 px-4 border-b',
        className
      )}>
      <div className="flex flex-row items-center gap-2">
        {showSelectAll && onSelectAll && (
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={(checked) => onSelectAll(!!checked)}
              aria-label={selectAllLabel}
            />
            {/* <span className="text-sm text-muted-foreground">
              {selectedItems.size > 0 ? `${selectedItems.size} selected` : selectAllLabel}
            </span> */}
          </div>
        )}

        {/* Search Bar */}
        {showSearch && onSearch && (
          <InputSearch
            size="sm"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            onClear={() => onSearch('')}
            placeholder={searchPlaceholder}
            className="w-full"
          />
        )}

        {/* Select All and Custom Controls */}
        <div className="flex items-center justify-between">
          {/* Custom actions/filters passed as children */}
          {children}
        </div>
      </div>
    </div>
  )
}
