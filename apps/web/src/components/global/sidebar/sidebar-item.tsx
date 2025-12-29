// components/global/sidebar/sidebar-item.tsx
'use client'

import { SidebarMenuButton, SidebarMenuSubButton } from '@auxx/ui/components/sidebar'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { MoreVertical, Pencil } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'

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
}: SidebarItemProps) {
  // Choose the right component based on whether it's a submenu item
  const Component = isSubmenu ? SidebarMenuSubButton : SidebarMenuButton
  const [popoverOpen, setPopoverOpen] = useState(false)
  // Only show dropdown if there's content to display
  const hasDropdownContent = editItems || onToggleEditMode

  return (
    <Component asChild className="h-7 py-0 pe-[3px]" tooltip={name}>
      <Link
        href={href}
        className={cn(`group/item flex h-7 w-full items-center justify-between ${className}`, {
          'bg-sidebar-accent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground':
            isActive,
          'bg-sidebar-accent': popoverOpen,
        })}>
        <div className="flex items-center">
          {color && !icon && (
            <div
              className="mr-2 size-2 rounded-full group-data-[collapsible=icon]:hidden"
              style={{ backgroundColor: color }}
            />
          )}
          {icon && <span className="[&_svg]:size-4 mr-2">{icon}</span>}
          <span className="group-data-[collapsible=icon]:hidden">{name}</span>
        </div>
        <div className="flex items-center group-data-[collapsible=icon]:hidden">
          {hasDropdownContent && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}>
              <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-6 rounded-md opacity-0 hover:bg-primary/10 hover:text-foreground/50 focus-visible:ring-primary/10 hover:bg-primary-200/50',
                      {
                        'bg-primary-200 opacity-100': popoverOpen,
                        'group-hover/item:opacity-100': !popoverOpen,
                      }
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setPopoverOpen(!popoverOpen)
                    }}>
                    <MoreVertical className="size-3.5" />
                    <span className="sr-only">Options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-40" align="start">
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
          {!popoverOpen && (
            <div className="pointer-events-none absolute right-[11px] top-1/2 flex -translate-y-1/2 text-right text-xs group-hover/item:opacity-0">
              {typeof count === 'number' && count}
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
