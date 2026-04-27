// components/global/sidebar/sidebar-item.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { SidebarMenuButton, SidebarMenuSubButton } from '@auxx/ui/components/sidebar'
import { cn } from '@auxx/ui/lib/utils'
import { MoreVertical, Pencil } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useRef, useState } from 'react'

interface SidebarItemProps {
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

export function SidebarItem({
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
  isInbox = false,
  onToggleEditMode,
  isEditing = false,
  editValue,
  onEditChange,
  onEditCommit,
  onEditCancel,
}: SidebarItemProps) {
  // Choose the right component based on whether it's a submenu item
  const Component = isSubmenu ? SidebarMenuSubButton : SidebarMenuButton
  const [popoverOpen, setPopoverOpen] = useState(false)
  // Only show dropdown if there's content to display
  const hasDropdownContent = editItems || onToggleEditMode

  // Reliably focus the input on entering edit mode (autoFocus alone races with
  // the closing dropdown returning focus to its trigger button).
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!isEditing) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [isEditing])

  return (
    <Component asChild className='h-7 py-0 pe-[3px]' tooltip={name}>
      <Link
        href={href}
        onClick={isEditing ? (e) => e.preventDefault() : undefined}
        className={cn(`group/item flex h-7 w-full items-center justify-between ${className}`, {
          'bg-sidebar-accent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground':
            isActive,
          'bg-sidebar-accent': popoverOpen || isEditing,
        })}>
        <div className='flex min-w-0 items-center grow'>
          {color && !icon && (
            <div
              className={cn(
                'mr-2 size-2 rounded-full group-data-[collapsible=icon]:hidden',
                getOptionColor(color as SelectOptionColor).swatch
              )}
            />
          )}
          {icon && <span className='[&_svg]:size-4 mr-2 shrink-0'>{icon}</span>}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue ?? ''}
              onChange={(e) => onEditChange?.(e.target.value)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onBlur={() => onEditCommit?.()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onEditCommit?.()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onEditCancel?.()
                }
              }}
              className='h-5 min-w-0 grow rounded bg-background px-1 text-sm outline-none ring-1 ring-border group-data-[collapsible=icon]:hidden'
            />
          ) : (
            <span className='truncate group-data-[collapsible=icon]:hidden'>{name}</span>
          )}
        </div>
        <div className='flex items-center group-data-[collapsible=icon]:hidden shrink-0'>
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
        </div>
        {/* {count ? (
          <Badge variant='secondary' className='ml-2'>
            {count}
          </Badge>
        ) : null} */}
      </Link>
    </Component>
  )
}
