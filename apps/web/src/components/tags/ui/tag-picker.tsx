// apps/web/src/components/tags/ui/tag-picker.tsx
'use client'

import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandNavigableItem,
  CommandNavigation,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'

/**
 * Tag interface for the picker - compatible with TagNode
 */
interface Tag {
  id: string
  title: string
  tag_emoji?: string | null
  tag_color?: string | null
  children: Tag[]
  parentId?: string | null
}

/**
 * Navigation item type that extends Tag with the required label property
 */
type TagNavigationItem = NavigationItem & Tag

/**
 * Props for the TagPicker component
 */
export interface TagPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Selected tag IDs or RecordIds */
  selectedTags: string[]
  /** Callback when selection changes - returns tag IDs or RecordIds based on tagEntityDefinitionId prop */
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
  /**
   * When provided, onChange returns RecordIds (e.g., "tag-def-id:tag-id")
   * and selectedTags is expected to be RecordIds.
   * This enables integration with the entity system via useSaveFieldValue.
   */
  tagEntityDefinitionId?: string
}

/**
 * Convert TagNode to Tag interface
 */
function tagNodeToTag(node: TagNode): Tag {
  return {
    id: node.id,
    title: node.title,
    tag_emoji: node.tag_emoji,
    tag_color: node.tag_color,
    children: node.children.map(tagNodeToTag),
    parentId: node.parentId,
  }
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
    <ScrollArea className='max-h-[300px]'>
      <CommandGroup>
        {tags.map((tag, index) => {
          if (!tag) return null
          const isSelected = selectedTags.includes(tag.id)
          const hasChildren = (tag.children?.length || 0) > 0
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
              <div className='flex items-center'>
                {tag.tag_emoji ? (
                  <span className='mr-2'>{tag.tag_emoji}</span>
                ) : (
                  <div
                    className='mr-2 size-3 rounded-full'
                    style={{ backgroundColor: tag.tag_color || '#94a3b8' }}
                  />
                )}
                <span>{tag.title}</span>
              </div>
              {isSelectable && (
                <Checkbox
                  checked={isSelected}
                  aria-label={`Select ${tag.title}`}
                  className='ml-auto pointer-events-none'
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
  flatTags,
  isLoading,
  tagEntityDefinitionId,
}: {
  selectedTags: string[]
  onChange: (selectedTags: string[]) => void
  onOpenChange: (open: boolean) => void
  allowMultiple: boolean
  onlyLeafSelection: boolean
  search: string
  setSearch: (search: string) => void
  tagHierarchy: Tag[]
  flatTags: Tag[]
  isLoading: boolean
  tagEntityDefinitionId?: string
}) {
  const {
    current,
    push,
    handleKeyDown: handleNavKeyDown,
  } = useCommandNavigation<TagNavigationItem>()
  const [selectedIndex, setSelectedIndex] = useState(-1)

  /**
   * Extract tag ID from either a plain tag ID or a RecordId.
   * If tagEntityDefinitionId is provided, selectedTags may be RecordIds like "tag-def:tag-id".
   */
  const extractTagId = useCallback(
    (idOrRecordId: string): string => {
      if (!tagEntityDefinitionId) return idOrRecordId
      // Check if it's a RecordId (contains :)
      if (idOrRecordId.includes(':')) {
        const { entityInstanceId } = parseRecordId(idOrRecordId as RecordId)
        return entityInstanceId
      }
      return idOrRecordId
    },
    [tagEntityDefinitionId]
  )

  /**
   * Convert tag ID to RecordId if tagEntityDefinitionId is provided.
   */
  const toTagRecordId = useCallback(
    (tagId: string): string => {
      if (!tagEntityDefinitionId) return tagId
      return toRecordId(tagEntityDefinitionId, tagId)
    },
    [tagEntityDefinitionId]
  )

  /**
   * Get selected tag IDs (extracted from RecordIds if needed).
   */
  const selectedTagIds = useMemo(() => {
    return selectedTags.map(extractTagId)
  }, [selectedTags, extractTagId])

  /**
   * Find children of a tag by traversing the hierarchy tree
   */
  const findChildren = useCallback((tags: Tag[] | undefined, id: string): Tag[] | null => {
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
  }, [])

  /**
   * Get tags for current navigation level
   */
  const tagsToDisplay = useMemo((): Tag[] => {
    if (search && flatTags.length > 0) {
      // When searching, show all matching tags
      return flatTags.filter(
        (tag) =>
          tag.title.toLowerCase().includes(search.toLowerCase()) || tag.tag_emoji?.includes(search)
      )
    }

    // If we're at the root level
    if (!current) {
      return tagHierarchy
    }

    // Find children by traversing the hierarchy tree
    const children = findChildren(tagHierarchy, current.id)
    return children || []
  }, [search, flatTags, current, tagHierarchy, findChildren])

  // Reset selected index when tags change
  // biome-ignore lint/correctness/useExhaustiveDependencies: tagsToDisplay triggers index reset when tag list changes
  useEffect(() => {
    setSelectedIndex(-1)
  }, [tagsToDisplay])

  /**
   * Navigate to a tag's children
   */
  const navigateToTag = useCallback(
    (tag: Tag) => {
      if (!tag.children?.length) return
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
      if (tag.children?.length && onlyLeafSelection) {
        navigateToTag(tag)
        return
      }

      if (selectedTagIds.includes(tag.id)) {
        // If selected, remove this tag
        const newTagIds = selectedTagIds.filter((id) => id !== tag.id)
        onChange(newTagIds.map(toTagRecordId))
      } else {
        // If single select mode, replace all selections
        if (!allowMultiple) {
          onChange([toTagRecordId(tag.id)])
          onOpenChange(false) // Close popover after single selection
        } else {
          // Otherwise add to selection
          onChange([...selectedTagIds, tag.id].map(toTagRecordId))
        }
      }
    },
    [
      selectedTagIds,
      onChange,
      allowMultiple,
      onOpenChange,
      onlyLeafSelection,
      navigateToTag,
      toTagRecordId,
    ]
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
          if (tag?.children?.length) {
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
          placeholder='Search tags...'
          value={search}
          onValueChange={setSearch}
          autoFocus
        />

        <CommandBreadcrumb rootLabel='All Tags' />

        {isLoading ? (
          <div className='py-6 text-center text-sm text-muted-foreground'>Loading tags...</div>
        ) : !Array.isArray(tagsToDisplay) ? (
          <CommandEmpty>Error loading tags or invalid data.</CommandEmpty>
        ) : tagsToDisplay.length === 0 ? (
          <CommandEmpty>No tags found.</CommandEmpty>
        ) : (
          <TagList
            tags={tagsToDisplay}
            selectedTags={selectedTagIds}
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
  tagEntityDefinitionId,
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

  // Use useTagHierarchy instead of separate API calls
  const { hierarchy, flatTags, isLoading, entityDefinitionId } = useTagHierarchy()

  // Convert TagNode[] to Tag[] for internal use
  const tagHierarchy = useMemo(() => hierarchy.map(tagNodeToTag), [hierarchy])
  const allTags = useMemo(() => flatTags.map(tagNodeToTag), [flatTags])

  // Use entityDefinitionId from useTagHierarchy if tagEntityDefinitionId is not provided
  const resolvedTagEntityDefId = tagEntityDefinitionId ?? entityDefinitionId ?? undefined

  // Reset search when popover closes
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

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
          // Prevent default focus behavior when using anchorRef, then focus the input manually
          if (anchorRef) {
            e.preventDefault()
            // Focus the CommandInput after the popover opens
            requestAnimationFrame(() => {
              const input = contentRef.current?.querySelector('input')
              input?.focus()
            })
          }
        }}
        onFocusOutside={(e) => {
          // Prevent closing on focus changes when using anchorRef
          if (anchorRef) e.preventDefault()
        }}
        {...props}>
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
            flatTags={allTags}
            isLoading={isLoading}
            tagEntityDefinitionId={resolvedTagEntityDefId}
          />
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
