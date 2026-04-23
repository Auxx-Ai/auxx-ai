// apps/web/src/components/dynamic-table/cells/primary-cell.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical } from 'lucide-react'

/**
 * Props for PrimaryCell component
 */
export interface PrimaryCellProps {
  /** Display value for the cell */
  value: string | null | undefined

  /** Fallback text when value is empty (default: 'Untitled') */
  fallbackText?: string

  /** Optional icon to show before the text */
  prefixIcon?: React.ReactNode

  /** Click handler for the title */
  onTitleClick: () => void

  /** Dropdown menu items passed as children for maximum flexibility */
  children: React.ReactNode

  /** Optional: Font weight for title (default: 'medium') */
  fontWeight?: 'normal' | 'medium' | 'semibold'

  /** Optional: Custom className for title */
  titleClassName?: string
}

/**
 * Unified primary cell component for tables
 * Shows a clickable title with underline and a dropdown menu with actions on hover
 * Used across multiple tables for consistent styling and behavior
 */
export function PrimaryCell({
  value,
  fallbackText = 'Untitled',
  prefixIcon,
  onTitleClick,
  children,
  fontWeight = 'medium',
  titleClassName = '',
}: PrimaryCellProps) {
  const displayValue = value || fallbackText
  const fontWeightClass = fontWeight === 'normal' ? '' : `font-${fontWeight}`

  return (
    <div className='flex items-center justify-between w-full min-h-9 pl-3 pr-1 text-sm group/primary'>
      <button
        className={cn(
          'flex items-center gap-2 text-left underline decoration-muted-foreground/50 hover:decoration-muted-foreground truncate max-w-[calc(100%-40px)]',
          fontWeightClass,
          titleClassName
        )}
        onClick={(e) => {
          e.stopPropagation()
          onTitleClick()
        }}>
        {prefixIcon}
        <span className='truncate'>{displayValue}</span>
      </button>

      <div onClick={(e) => e.stopPropagation()} className='shrink-0'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon-xs'
              className='rounded-md sm:opacity-0 sm:group-hover/primary:opacity-100 transition-opacity data-[state=open]:opacity-100!'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>{children}</DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
