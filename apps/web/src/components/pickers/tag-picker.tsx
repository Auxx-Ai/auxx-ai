// components/pickers/tag-picker.tsx
'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandNavigation,
  CommandBreadcrumb,
  CommandNavigableItem,
  useCommandNavigation,
  type NavigationItem,
} from '@auxx/ui/components/command'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { api } from '~/trpc/react'
import { cn } from '@auxx/ui/lib/utils'
import { ScrollArea } from '@auxx/ui/components/scroll-area'

/**
 * Tag interface for the picker
 */
interface Tag {
  id: string
  title: string
  emoji?: string | null
  color?: string | null
  tags?: Tag[]
  parentId?: string | null
}

/**
 * Navigation item type that extends Tag with the required label property
 */
type TagNavigationItem = NavigationItem & Tag

/**
 * Props for the TagPicker component
 */
interface TagPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selectedTags: string[]
  onChange: (selectedTags: string[]) => void
  allowMultiple?: boolean
  onlyLeafSelection?: boolean
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  style?: React.CSSProperties
  /** Trigger element - if provided, renders as popover trigger */
  children?: React.ReactNode
  /** External anchor ref - popover anchors to this element instead of trigger */
  anchorRef?: React.RefObject<HTMLElement | null>
}

/**
 * Internal tag list component that renders the tag items
 */
function TagList({
  tags,
  selectedTags,
  onlyLeafSelection,
  toggleTag,
  selectedIndex,
  enableKeyboardNavigation,
}: {
  tags: Tag[]
  selectedTags: string[]
  onlyLeafSelection: boolean
  toggleTag: (tag: Tag) => void
  selectedIndex: number
  enableKeyboardNavigation: boolean
}) {
  return (
    <ScrollArea className="max-h-[300px]">
      <CommandGroup>
        {tags.map((tag, index) => {
          if (!tag) return null
          const isSelected = selectedTags.includes(tag.id)
          const hasChildren = (tag.tags?.length || 0) > 0
          const isSelectable = !onlyLeafSelection || !hasChildren
          const isKeyboardSelected = enableKeyboardNavigation && selectedIndex === index

          return (
            <CommandNavigableItem
              key={tag.id}
              item={{ ...tag, label: tag.title }}
              hasChildren={hasChildren}
              onSelect={() => toggleTag(tag)}
              className={cn(
                'px-2 rounded-full',
                isKeyboardSelected && 'bg-accent text-accent-foreground'
              )}>
              <div className="flex items-center">
                {tag.emoji ? (
                  <span className="mr-2">{tag.emoji}</span>
                ) : (
                  <div
                    className="mr-2 size-3 rounded-full"
                    style={{ backgroundColor: tag.color || '#94a3b8' }}
                  />
                )}
                <span>{tag.title}</span>
              </div>
              {isSelectable && (
                <Checkbox
                  checked={isSelected}
                  aria-label={`Select ${tag.title}`}
                  className="pointer-events-none"
                />
              )}
            </CommandNavigableItem>
          )
        })}
      </CommandGroup>
    </ScrollArea>
  )
}

/**
 * Inner content component that has access to CommandNavigation context
 */
function TagPickerContent({
  selectedTags,
  onChange,
  onOpenChange,
  allowMultiple,
  onlyLeafSelection,
  search,
  setSearch,
  tagHierarchy,
  allTags,
  isLoading,
}: {
  selectedTags: string[]
  onChange: (selectedTags: string[]) => void
  onOpenChange: (open: boolean) => void
  allowMultiple: boolean
  onlyLeafSelection: boolean
  search: string
  setSearch: (search: string) => void
  tagHierarchy: Tag[] | undefined
  allTags: Tag[] | undefined
  isLoading: boolean
}) {
  const { current, push, handleKeyDown: handleNavKeyDown } =
    useCommandNavigation<TagNavigationItem>()
  const [selectedIndex, setSelectedIndex] = useState(-1)

  /**
   * Find children of a tag by traversing the hierarchy tree
   */
  const findChildren = useCallback((tags: Tag[] | undefined, id: string): Tag[] | null => {
    if (!tags || tags.length === 0) return null

    for (const tag of tags) {
      if (tag.id === id) {
        return tag.tags || []
      }
      if (tag.tags?.length) {
        const found = findChildren(tag.tags, id)
        if (found) return found
      }
    }
    return null
  }, [])

  /**
   * Get tags for current navigation level
   */
  const tagsToDisplay = useMemo((): Tag[] => {
    if (search && allTags) {
      // When searching, show all matching tags
      return allTags.filter(
        (tag) =>
          tag.title.toLowerCase().includes(search.toLowerCase()) ||
          (tag.emoji && tag.emoji.includes(search))
      )
    }

    // If we're at the root level
    if (!current) {
      return tagHierarchy || []
    }

    // Find children by traversing the hierarchy tree
    const children = findChildren(tagHierarchy, current.id)
    return children || []
  }, [search, allTags, current, tagHierarchy, findChildren])

  // Reset selected index when tags change
  useEffect(() => {
    setSelectedIndex(-1)
  }, [tagsToDisplay])

  /**
   * Navigate to a tag's children
   */
  const navigateToTag = useCallback(
    (tag: Tag) => {
      if (!tag.tags?.length) return
      push({ ...tag, label: tag.title })
      setSelectedIndex(-1)
    },
    [push]
  )

  /**
   * Handle tag selection toggle
   */
  const toggleTag = useCallback(
    (tag: Tag) => {
      // If it has children and onlyLeafSelection is true, don't toggle - just navigate
      if (tag.tags?.length && onlyLeafSelection) {
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
    },
    [selectedTags, onChange, allowMultiple, onOpenChange, onlyLeafSelection, navigateToTag]
  )

  // Get selected item for keyboard navigation
  const selectedItem = useMemo(() => {
    if (selectedIndex < 0 || selectedIndex >= tagsToDisplay.length) return null
    const tag = tagsToDisplay[selectedIndex]
    return tag ? { ...tag, label: tag.title } : null
  }, [selectedIndex, tagsToDisplay])

  /**
   * Keyboard handler combining navigation and selection
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle navigation keys (←, →, Enter)
      handleNavKeyDown(e, {
        selectedItem,
        onNavigateRight: (item) => {
          const tag = tagsToDisplay.find((t) => t.id === item.id)
          if (tag?.tags?.length) {
            setSelectedIndex(-1)
            return true
          }
          return false
        },
        onSelect: (item) => {
          const tag = tagsToDisplay.find((t) => t.id === item.id)
          if (tag) {
            toggleTag(tag)
          }
        },
      })

      // Handle selection keys (↑, ↓)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < tagsToDisplay.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : tagsToDisplay.length - 1))
      } else if (e.key === 'Escape') {
        onOpenChange(false)
      }
    },
    [handleNavKeyDown, selectedItem, tagsToDisplay, toggleTag, onOpenChange]
  )

  return (
    <Command shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandList>
        <CommandInput
          placeholder="Search tags..."
          value={search}
          onValueChange={setSearch}
          className="h-9"
        />

        <CommandBreadcrumb rootLabel="All Tags" />

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading tags...</div>
        ) : !Array.isArray(tagsToDisplay) ? (
          <CommandEmpty>Error loading tags or invalid data.</CommandEmpty>
        ) : tagsToDisplay.length === 0 ? (
          <CommandEmpty>No tags found.</CommandEmpty>
        ) : (
          <TagList
            tags={tagsToDisplay}
            selectedTags={selectedTags}
            onlyLeafSelection={onlyLeafSelection}
            toggleTag={toggleTag}
            selectedIndex={selectedIndex}
            enableKeyboardNavigation={true}
          />
        )}
      </CommandList>
    </Command>
  )
}

/**
 * TagPicker component with hierarchical navigation
 */
export function TagPicker({
  open,
  onOpenChange,
  selectedTags: selectedTagsProp = [],
  onChange,
  allowMultiple = true,
  onlyLeafSelection = true,
  className,
  align = 'end',
  children,
  anchorRef,
  ...props
}: TagPickerProps) {
  const selectedTags = selectedTagsProp ?? []
  const [isOpen, setIsOpen] = useState(open ?? false)
  const [search, setSearch] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  // Sync with controlled open prop
  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  /** Handle open state changes */
  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  // Fetch tag hierarchy
  const { data: tagHierarchy, isLoading: isLoadingHierarchy } = api.tag.getHierarchy.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
    }
  )

  // Get flat tags for search
  const { data: allTags, isLoading: isLoadingTags } = api.tag.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })

  // Reset search when popover closes
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  const isLoading = isLoadingHierarchy || isLoadingTags

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {/* Use external anchor if provided, otherwise use trigger */}
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : children ? (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      ) : null}
      <PopoverContent
        className={cn('w-[300px] p-0', className)}
        ref={contentRef}
        align={align}
        onOpenAutoFocus={(e) => {
          // Prevent focus issues when using anchorRef
          if (anchorRef) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          // Prevent closing on focus changes when using anchorRef
          if (anchorRef) e.preventDefault()
        }}
        {...props}
      >
        <CommandNavigation<TagNavigationItem> isGlobalSearch={!!search}>
          <TagPickerContent
            selectedTags={selectedTags}
            onChange={onChange}
            onOpenChange={handleOpenChange}
            allowMultiple={allowMultiple}
            onlyLeafSelection={onlyLeafSelection}
            search={search}
            setSearch={setSearch}
            tagHierarchy={tagHierarchy}
            allTags={allTags}
            isLoading={isLoading}
          />
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
