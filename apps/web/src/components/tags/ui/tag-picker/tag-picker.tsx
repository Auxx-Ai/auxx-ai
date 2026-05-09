// apps/web/src/components/tags/ui/tag-picker/tag-picker.tsx
'use client'

import { CommandNavigation } from '@auxx/ui/components/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTagHierarchy } from '../../hooks/use-tag-hierarchy'
import type { TagNode, TagScopeValue } from '../../types'
import { TagPickerContent } from './tag-picker-content'
import type { Tag, TagNavigationItem } from './types'

/**
 * Props for the TagPicker component.
 */
export interface TagPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Selected tag IDs or RecordIds */
  selectedTags: string[]
  /**
   * Tag IDs or RecordIds to render in an indeterminate (half-checked) state.
   * Used in bulk contexts where a tag is applied to some but not all selected items.
   * Clicking an indeterminate tag promotes it to fully selected via the normal toggle flow.
   */
  indeterminateTags?: string[]
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
  /**
   * Resource-type scope for the tag pool. Filters fetched tags and is assigned
   * to inline-created tags. Required — every call site states intent so a
   * defaulted scope can never silently leak the wrong pool.
   */
  scope: TagScopeValue
  /**
   * When true, the picker shows an inline "Create <name>" row when the search
   * doesn't match an existing tag. Default: true.
   */
  canCreate?: boolean
}

/** Convert TagNode to the internal Tag interface used by the picker. */
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
 * TagPicker — popover wrapper around the tag list with hierarchical navigation,
 * inline create, and a manage-mode toggle for editing/deleting tags.
 */
export function TagPicker({
  open,
  onOpenChange,
  selectedTags: selectedTagsProp = [],
  indeterminateTags: indeterminateTagsProp,
  onChange,
  allowMultiple = true,
  onlyLeafSelection = true,
  className,
  align = 'end',
  children,
  anchorRef,
  tagEntityDefinitionId,
  scope,
  canCreate = true,
  ...props
}: TagPickerProps) {
  const selectedTags = selectedTagsProp ?? []
  const indeterminateTags = indeterminateTagsProp ?? []
  const [isOpen, setIsOpen] = useState(open ?? false)
  const [search, setSearch] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  const { hierarchy, flatTags, isLoading, entityDefinitionId, refresh } = useTagHierarchy({ scope })

  const tagHierarchy = useMemo(() => hierarchy.map(tagNodeToTag), [hierarchy])
  const allTags = useMemo(() => flatTags.map(tagNodeToTag), [flatTags])

  const resolvedTagEntityDefId = tagEntityDefinitionId ?? entityDefinitionId ?? undefined

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : children ? (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      ) : null}
      <PopoverContent
        className={cn('w-[340px] p-0', className)}
        ref={contentRef}
        align={align}
        onOpenAutoFocus={(e) => {
          if (anchorRef) {
            e.preventDefault()
            requestAnimationFrame(() => {
              const input = contentRef.current?.querySelector('input')
              input?.focus()
            })
          }
        }}
        onFocusOutside={(e) => {
          if (anchorRef) e.preventDefault()
        }}
        {...props}>
        <CommandNavigation<TagNavigationItem> isGlobalSearch={!!search}>
          <TagPickerContent
            selectedTags={selectedTags}
            indeterminateTags={indeterminateTags}
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
            scope={scope}
            canCreate={canCreate}
            refresh={refresh}
          />
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}
