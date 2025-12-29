// components/global/sidebar/sidebar-group-header.tsx
'use client'

import { SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import { Button } from '@auxx/ui/components/button'
import { Check, ChevronRight, MoreVertical, Pencil } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import React from 'react'

interface SidebarGroupHeaderProps {
  title: string
  isEditMode: boolean
  onToggleEditMode: () => void
  isOpen: boolean
  toggleOpen: () => void
  additionalOptions?: React.ReactNode
  isGroupVisible?: boolean
  onToggleGroupVisibility?: () => void
  /** Hide the "Edit Sidebar" option in dropdown menu */
  hideEditOption?: boolean
}

export function SidebarGroupHeader({
  title,
  isEditMode,
  onToggleEditMode,
  isOpen,
  toggleOpen,
  additionalOptions,
  isGroupVisible = true,
  onToggleGroupVisibility,
  hideEditOption = false,
}: SidebarGroupHeaderProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false)

  /** Handle click on the header row to toggle open/closed */
  function handleRowClick() {
    if (!isEditMode) {
      toggleOpen()
    }
  }

  return (
    <div
      data-state={isOpen || isEditMode ? 'open' : 'closed'}
      onClick={handleRowClick}
      className={cn(
        'flex items-center justify-between h-7.5 rounded-md hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden cursor-pointer',
        popoverOpen && 'bg-sidebar-accent',
        isEditMode && !isGroupVisible && 'opacity-50'
      )}>
      {isEditMode && onToggleGroupVisibility ? (
        <div
          className="flex flex-1 items-center gap-2 px-2"
          onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isGroupVisible}
            className="border-blue-500 data-[state=checked]:border-info data-[state=checked]:bg-info"
            onCheckedChange={onToggleGroupVisibility}
          />
          <span className="text-xs font-medium text-sidebar-foreground/70 uppercase tracking-wide">
            {title}
          </span>
        </div>
      ) : (
        <SidebarGroupLabel className="cursor-pointer select-none">
          {title}
          <ChevronRight
            className={cn('transition-transform duration-200', isOpen && 'rotate-90')}
          />
        </SidebarGroupLabel>
      )}
      {!isEditMode && (additionalOptions || !hideEditOption) && (
        <DropdownMenu open={popoverOpen} onOpenChange={setPopoverOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-6 me-1 rounded-md opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:ring-primary/10 group-hover:opacity-100 hover:bg-primary-200/50',
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
              {additionalOptions}
              {!hideEditOption && (
                <DropdownMenuItem onClick={onToggleEditMode}>
                  {isEditMode ? <Check /> : <Pencil />}
                  {isEditMode ? 'Done Editing' : 'Edit Sidebar'}
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
