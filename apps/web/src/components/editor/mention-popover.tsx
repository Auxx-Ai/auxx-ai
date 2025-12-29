// src/components/editor/mention-popover.tsx
'use client'

import { useEffect, useImperativeHandle, useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'

/**
 * Interface for mention suggestion items
 */
export interface MentionItem {
  id: string
  name: string
  email?: string
  avatar?: string
  role?: string
}

/**
 * Props for the MentionPopover component
 */
interface MentionPopoverProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
  isLoading?: boolean // Add isLoading prop
}

/**
 * Reference interface for the MentionPopover component
 */
export interface MentionPopoverRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * MentionPopover component for displaying user mentions in the editor
 * Based on the slash-command implementation patterns
 */
type MentionRef = MentionPopoverRef
type MentionProps = MentionPopoverProps & React.RefAttributes<MentionRef>

export const MentionPopover: React.FC<MentionProps> = ({
  items,
  command,
  isLoading = false,
  ref,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  /**
   * Handle keyboard navigation and selection
   */
  const onKeyDown = (event: KeyboardEvent): boolean => {
    if (event.key === 'ArrowUp') {
      setSelectedIndex((selectedIndex + items.length - 1) % items.length)
      return true
    }

    if (event.key === 'ArrowDown') {
      setSelectedIndex((selectedIndex + 1) % items.length)
      return true
    }

    if (event.key === 'Enter') {
      if (items[selectedIndex]) {
        command(items[selectedIndex])
      }
      return true
    }

    return false
  }

  /**
   * Reset selected index when items change
   */
  useEffect(() => {
    setSelectedIndex(0)
  }, [items])

  /**
   * Expose onKeyDown method to parent via ref
   */
  useImperativeHandle(ref, () => ({ onKeyDown }))

  /**
   * Handle item selection via click
   */
  const selectItem = (index: number) => {
    const item = items[index]
    if (item) {
      command(item)
    }
  }

  return (
    <Command className=" bg-background shadow-sm shadow-black/25 z-100">
      <CommandList>
        {items.length > 0 ? (
          <CommandGroup>
            {items.map((item, index) => (
              <CommandItem
                className={` ${index === selectedIndex ? 'bg-accent' : ''}`}
                key={item.id}
                value={item.name}
                onMouseEnter={() => setSelectedIndex(index)}
                onSelect={() => selectItem(index)}>
                <div className="">
                  {item.avatar ? (
                    <img
                      src={item.avatar}
                      alt={item.name}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    item.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex flex-col overflow-hidden">
                  <div className="truncate font-medium">{item.name}</div>
                  {item.email && (
                    <div className="truncate text-xs text-muted-foreground">{item.email}</div>
                  )}
                  {item.role && (
                    <div className="truncate text-xs text-muted-foreground">{item.role}</div>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : isLoading ? (
          <CommandEmpty className="">Loading team members...</CommandEmpty>
        ) : (
          <CommandEmpty className="px-2 text-muted-foreground">No team members found</CommandEmpty>
        )}
      </CommandList>
    </Command>
  )
}

MentionPopover.displayName = 'MentionPopover'
