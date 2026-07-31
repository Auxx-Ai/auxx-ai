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

  /**
   * Dropdown menu items passed as children for maximum flexibility. When
   * omitted, the hover kebab menu is not rendered at all (widget/read-only use).
   *
   * ⚠ Items only — this cell owns the `DropdownMenu` wrapper, so anything passed
   * here is mounted inside `DropdownMenuContent` and is unmounted with it. A menu
   * that opens dialogs cannot be a child; pass it as {@link actions} instead.
   */
  children?: React.ReactNode

  /**
   * A COMPLETE menu (its own trigger, content and dialogs) rendered in the
   * trailing slot instead of this cell's built-in kebab.
   *
   * Needed because a menu whose items open dialogs must mount those dialogs as
   * SIBLINGS of its `DropdownMenu` — selecting an item closes the menu, and Radix
   * unmounts the content with it, tearing down a dialog in the same tick it
   * opened. `children` cannot express that; this can.
   *
   * Mutually exclusive with `children` in practice: when both are given, `actions`
   * wins and the built-in kebab is not rendered.
   */
  actions?: React.ReactNode

  /** Optional inline node rendered right after the title (e.g. a source badge). */
  suffix?: React.ReactNode

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
  actions,
  suffix,
  fontWeight = 'medium',
  titleClassName = '',
}: PrimaryCellProps) {
  const displayValue = value || fallbackText
  const fontWeightClass = fontWeight === 'normal' ? '' : `font-${fontWeight}`
  const hasTrailing = !!actions || !!children

  return (
    <div className='flex items-center justify-between w-full min-h-9 pl-3 pr-1 text-sm group/primary'>
      <div
        className={cn(
          'flex items-center gap-1.5 min-w-0',
          hasTrailing ? 'max-w-[calc(100%-40px)]' : 'max-w-full'
        )}>
        <button
          className={cn(
            'flex items-center gap-2 text-left underline decoration-muted-foreground/50 hover:decoration-muted-foreground truncate min-w-0',
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
        {suffix}
      </div>

      {/* The stopPropagation wrapper is shared: either menu sits inside a row
          whose own click opens the record, and neither should trigger it. */}
      {hasTrailing && (
        <div onClick={(e) => e.stopPropagation()} className='shrink-0'>
          {actions ?? (
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
          )}
        </div>
      )}
    </div>
  )
}
