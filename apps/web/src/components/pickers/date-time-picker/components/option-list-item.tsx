// apps/web/src/components/pickers/date-time-picker/components/option-list-item.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import React, { useEffect, useRef } from 'react'
import type { OptionListItemProps } from '../types'

/**
 * Individual selectable item in scrollable option lists
 * Auto-scrolls into view when selected
 */
const OptionListItem: React.FC<OptionListItemProps> = ({
  isSelected,
  onClick,
  noAutoScroll,
  children,
}) => {
  const listItemRef = useRef<HTMLLIElement>(null)

  // Auto-scroll selected item into view on mount
  useEffect(() => {
    if (isSelected && !noAutoScroll) {
      listItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isSelected, noAutoScroll])

  /** Handle click with smooth scroll */
  const handleClick = () => {
    listItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    onClick()
  }

  return (
    <li
      ref={listItemRef}
      className={cn(
        'flex cursor-pointer items-center justify-center rounded-md px-1.5 py-1 text-sm font-medium transition-colors',
        isSelected ? 'bg-primary-100 text-primary-600' : 'text-secondary-600 hover:bg-secondary-100'
      )}
      onClick={handleClick}>
      {children}
    </li>
  )
}

export default React.memo(OptionListItem)
