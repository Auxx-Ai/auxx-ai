// components/tags/tag-picker.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { PopoverContent } from '@auxx/ui/components/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'

interface Tag {
  id: string
  title: string
  emoji?: string | null
  color?: string | null
  children?: Tag[]
  parentId?: string | null
}

interface TagPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTags: string[]
  onChange: (selectedTags: string[]) => void
  allowMultiple?: boolean
  onlyLeafSelection?: boolean
  className?: string
  disabled?: boolean // Optional prop to disable the picker
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  style?: React.CSSProperties // Additional styles for the popover
}

export function TagPicker({
  open,
  onOpenChange,
  selectedTags: selectedTagsProp = [], // Keep the default prop value
  onChange,
  allowMultiple = true,
  onlyLeafSelection = true,
  disabled = false, // Default to false
  className,
  align = 'end',
  ...props
}: TagPickerProps) {
  const selectedTags = selectedTagsProp ?? []
  // State
  const [search, setSearch] = useState('')
  const [navigationStack, setNavigationStack] = useState<Tag[]>([])
  const [currentTagId, setCurrentTagId] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Fetch tag hierarchy
  const { data: tagHierarchy, isLoading: isLoadingHierarchy } = api.tag.getHierarchy.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    }
  )

  // Get flat tags for search
  const { data: allTags, isLoading: isLoadingTags } = api.tag.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })
  // Current tags to display - based on navigation level
  const currentTags = (): Tag[] => {
    if (search && allTags) {
      // When searching, show all matching tags
      return allTags.filter(
        (tag) =>
          tag.title.toLowerCase().includes(search.toLowerCase()) ||
          (tag.emoji && tag.emoji.includes(search))
      )
    }

    // If we're at the root level
    if (!currentTagId) {
      return tagHierarchy || []
    }

    // If we're in a nested level, find the current parent tag's children
    const findChildren = (tags: Tag[] | undefined, id: string): Tag[] | null => {
      if (!tags || tags.length === 0) return null

      for (const tag of tags) {
        if (tag.id === id) {
          return tag.children || []
        }
        if (tag.children?.length) {
          const found = findChildren(tag.children, id)
          if (found) return found
        }
      }
      return null
    }

    const children = findChildren(tagHierarchy, currentTagId)
    return children || []
  }

  // Navigation functions
  const navigateToTag = (tag: Tag) => {
    if (!tag.children?.length) return

    // Push current tag to navigation stack
    setNavigationStack((prev) => [...prev, tag])
    setCurrentTagId(tag.id)
    setSearch('') // Clear search when navigating

    // Scroll back to top when navigating
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const navigateBack = () => {
    // Pop from navigation stack
    setNavigationStack((prev) => {
      const newStack = [...prev]
      newStack.pop()
      const parentTag = newStack.length > 0 ? newStack[newStack.length - 1] : null
      setCurrentTagId(parentTag?.id || null)
      return newStack
    })
  }

  const navigateTo = (index: number) => {
    // Navigate to specific level in breadcrumb
    setNavigationStack((prev) => {
      const newStack = prev.slice(0, index + 1)
      const parentTag = newStack.length > 0 ? newStack[newStack.length - 1] : null
      setCurrentTagId(parentTag?.id || null)
      return newStack
    })
  }

  // Handle tag selection
  const toggleTag = (tag: Tag) => {
    // If it has children and onlyLeafSelection is true, don't toggle - just navigate
    if (tag.children?.length && onlyLeafSelection) {
      navigateToTag(tag)
      return
    }

    if (selectedTags.includes(tag.id)) {
      // If selected, remove this tag
      onChange(selectedTags.filter((id) => id !== tag.id))
    } else {
      // If single select mode, replace all selections
      if (!allowMultiple) {
        onChange([tag.id])
        onOpenChange(false) // Close popover after single selection
      } else {
        // Otherwise add to selection
        onChange([...selectedTags, tag.id])
      }
    }
  }

  // Reset navigation when popover closes
  useEffect(() => {
    if (!open) {
      setNavigationStack([])
      setCurrentTagId(null)
      setSearch('')
    }
  }, [open])

  // Get the tags to display
  const tagsToDisplay = currentTags()
  const isLoading = isLoadingHierarchy || isLoadingTags
  // return <PopoverContent>fds</PopoverContent>

  return (
    <PopoverContent
      className={cn('w-[300px] p-0', className)}
      ref={contentRef}
      align={align}
      {...props}>
      <Command shouldFilter={false}>
        <CommandList>
          <CommandInput
            placeholder="Search tags..."
            value={search}
            onValueChange={setSearch}
            className="h-9"
          />

          {/* Breadcrumb Navigation */}
          {!search && navigationStack.length > 0 && (
            <div className="flex items-center border-b px-2 py-1 text-sm">
              <Button variant="ghost" size="icon" className="mr-1 h-6 w-6" onClick={navigateBack}>
                <ChevronLeft className="h-3.5 w-3.5" />
                <span className="sr-only">Back</span>
              </Button>

              <div className="flex items-center overflow-x-auto">
                <button
                  onClick={() => {
                    setNavigationStack([])
                    setCurrentTagId(null)
                  }}
                  className="whitespace-nowrap px-1 hover:underline">
                  All Tags
                </button>

                {navigationStack.map((tag, index) => (
                  <div key={tag.id} className="flex items-center">
                    <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 opacity-50" />
                    <button
                      onClick={() => navigateTo(index)}
                      className={cn(
                        'whitespace-nowrap px-1 hover:underline',
                        index === navigationStack.length - 1 ? 'font-semibold' : ''
                      )}>
                      {tag.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading tags...</div>
          ) : !Array.isArray(tagsToDisplay) ? (
            <CommandEmpty>Error loading tags or invalid data.</CommandEmpty> // Or handle error state
          ) : tagsToDisplay.length === 0 ? (
            <CommandEmpty>No tags found.</CommandEmpty>
          ) : (
            <CommandGroup>
              <ScrollArea className="max-h-[300px]">
                {tagsToDisplay.map((tag) => {
                  if (!tag) return null // Skip if tag is null or undefined
                  const isSelected = selectedTags.includes(tag.id)
                  const hasChildren = (tag.children?.length || 0) > 0
                  const isSelectable = !onlyLeafSelection || !hasChildren
                  return (
                    <CommandItem
                      key={tag.id}
                      value={tag.id}
                      onSelect={() => toggleTag(tag)}
                      className="flex cursor-pointer items-center justify-between px-2 rounded-full">
                      <div className="flex items-center">
                        {tag.emoji ? (
                          <span className="mr-2">{tag.emoji}</span>
                        ) : (
                          <div
                            className="mr-2 h-3 w-3 rounded-full"
                            style={{ backgroundColor: tag.color || '#94a3b8' }}
                          />
                        )}
                        <span>{tag.title}</span>
                      </div>

                      <div className="flex items-center">
                        {isSelectable && (
                          <Checkbox
                            // defaultChecked={true}
                            checked={isSelected}
                            onCheckedChange={() => toggleTag(tag)}
                            aria-label={`Select ${tag.title}`}
                            className="mr-2"
                            // Fix: prevent CommandItem onSelect from firing when clicking the checkbox
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}

                        {hasChildren && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigateToTag(tag)
                            }}>
                            <ChevronRight />
                            <span className="sr-only">Show children</span>
                          </Button>
                        )}
                      </div>
                    </CommandItem>
                  )
                })}
              </ScrollArea>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </PopoverContent>
  )
}
