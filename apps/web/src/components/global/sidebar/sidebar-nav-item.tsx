// components/global/sidebar/sidebar-nav-item.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical, Pencil } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { SidebarItem } from './sidebar-item'

interface SidebarNavItemProps {
  id: string
  name: string
  href: string
  icon?: ReactNode
  count?: number
  color?: string
  isSubmenu?: boolean
  className?: string
  isActive?: boolean
  isInbox?: boolean
  editItems?: ReactNode
  /** Inline action button rendered in place of the 3-dot dropdown. Mutually exclusive with editItems/onToggleEditMode. */
  action?: ReactNode
  onToggleEditMode?: () => void
  /** When true, renders the name as an editable input. Click-through to navigation is suppressed. */
  isEditing?: boolean
  /** Current draft value while editing. Required when isEditing is true. */
  editValue?: string
  /** Called when the editing value changes. */
  onEditChange?: (value: string) => void
  /** Called on Enter or blur to commit the edit. */
  onEditCommit?: () => void
  /** Called on Escape to cancel the edit. */
  onEditCancel?: () => void
}

/**
 * Rich sidebar row: wraps the lean {@link SidebarItem} and reproduces the
 * count-hides-on-hover badge + 3-dot dropdown (`editItems`/`onToggleEditMode`)
 * + inline `action` button behavior via the `end` slot.
 */
export function SidebarNavItem({
  id,
  name,
  href,
  icon,
  count,
  color,
  isSubmenu = false,
  className = '',
  isActive,
  editItems,
  action,
  isInbox = false,
  onToggleEditMode,
  isEditing = false,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
}: SidebarNavItemProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  // Only show dropdown if there's content to display
  const hasDropdownContent = editItems || onToggleEditMode

  const end = (
    <>
      {!popoverOpen && typeof count === 'number' && (
        <>
          <span className='pointer-events-none text-xs text-muted-foreground sm:hidden'>
            {count}
          </span>
          <div className='pointer-events-none absolute right-[11px] top-1/2 hidden -translate-y-1/2 text-right text-xs sm:flex sm:group-hover/item:opacity-0'>
            {count}
          </div>
        </>
      )}
      {action && !hasDropdownContent && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}>
          {action}
        </div>
      )}
      {hasDropdownContent && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}>
          <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className={cn(
                  'size-6 shrink-0 rounded-md opacity-100 sm:opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50',
                  {
                    'bg-primary-200 opacity-100': popoverOpen,
                    'sm:group-hover/item:opacity-100': !popoverOpen,
                  }
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setPopoverOpen(!popoverOpen)
                }}>
                <MoreVertical className='size-3.5' />
                <span className='sr-only'>Options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-50'
              align={isSubmenu ? 'end' : 'start'}
              sideOffset={4}>
              <DropdownMenuGroup>
                {editItems}
                {onToggleEditMode && (
                  <DropdownMenuItem onClick={onToggleEditMode}>
                    <Pencil />
                    Edit Sidebar
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </>
  )

  return (
    <SidebarItem
      id={id}
      name={name}
      href={href}
      icon={icon}
      color={color}
      isSubmenu={isSubmenu}
      className={cn(className, popoverOpen && 'bg-sidebar-accent')}
      isActive={isActive}
      isEditing={isEditing}
      editValue={editValue}
      onEditChange={onEditChange}
      onEditCommit={onEditCommit}
      onEditCancel={onEditCancel}
      end={end}
    />
  )
}
