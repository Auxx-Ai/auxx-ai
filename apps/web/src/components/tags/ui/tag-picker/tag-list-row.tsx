// apps/web/src/components/tags/ui/tag-picker/tag-list-row.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { CommandGroup, CommandNavigableItem } from '@auxx/ui/components/command'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { ManageActions } from './manage-actions'
import type { Tag } from './types'

interface TagListRowProps {
  tag: Tag
  isSelected: boolean
  isIndeterminate: boolean
  hasChildren: boolean
  isSelectable: boolean
  isKeyboardSelected: boolean
  isManageMode: boolean
  navigateToTag: (tag: Tag) => void
  toggleTag: (tag: Tag) => void
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
}

function TagListRow({
  tag,
  isSelected,
  isIndeterminate,
  hasChildren,
  isSelectable,
  isKeyboardSelected,
  isManageMode,
  navigateToTag,
  toggleTag,
  onEdit,
  onDelete,
}: TagListRowProps) {
  const handleSelect = () => {
    if (isManageMode) {
      if (hasChildren) navigateToTag(tag)
      // Leaf rows in manage mode are no-ops; user must use the action buttons.
      return
    }
    toggleTag(tag)
  }

  return (
    <CommandNavigableItem
      item={{ ...tag, label: tag.title }}
      hasChildren={hasChildren}
      onSelect={handleSelect}
      className={cn(
        'px-2 rounded-full',
        isManageMode && 'group/tag relative overflow-hidden',
        isKeyboardSelected && 'bg-accent text-accent-foreground'
      )}>
      <div className='flex items-center min-w-0'>
        {tag.tag_emoji ? (
          <span className='mr-2'>{tag.tag_emoji}</span>
        ) : (
          <div
            className={cn(
              'mr-2 size-3 rounded-full shrink-0',
              getOptionColor((tag.tag_color || 'gray') as SelectOptionColor).swatch
            )}
          />
        )}
        <span className='truncate'>{tag.title}</span>
      </div>
      {!isManageMode && isSelectable && (
        <Checkbox
          checked={isSelected ? true : isIndeterminate ? 'indeterminate' : false}
          aria-label={`Select ${tag.title}`}
          className='ml-auto pointer-events-none'
        />
      )}
      {isManageMode && hasChildren && (
        <span className='ml-auto text-[10px] text-muted-foreground bg-secondary rounded px-1 py-[1px]'>
          Open to edit
        </span>
      )}
      {isManageMode && !hasChildren && (
        <ManageActions onEdit={() => onEdit(tag)} onDelete={() => onDelete(tag)} />
      )}
    </CommandNavigableItem>
  )
}

interface TagListProps {
  tags: Tag[]
  selectedTags: string[]
  indeterminateTags: string[]
  onlyLeafSelection: boolean
  toggleTag: (tag: Tag) => void
  navigateToTag: (tag: Tag) => void
  selectedIndex: number
  enableKeyboardNavigation: boolean
  isManageMode: boolean
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
}

/**
 * Renders the list of tag rows inside the picker.
 */
export function TagList({
  tags,
  selectedTags,
  indeterminateTags,
  onlyLeafSelection,
  toggleTag,
  navigateToTag,
  selectedIndex,
  enableKeyboardNavigation,
  isManageMode,
  onEdit,
  onDelete,
}: TagListProps) {
  return (
    <ScrollArea className='max-h-[300px]'>
      <CommandGroup>
        {tags.map((tag, index) => {
          if (!tag) return null
          const isSelected = selectedTags.includes(tag.id)
          const isIndeterminate = !isSelected && indeterminateTags.includes(tag.id)
          const hasChildren = (tag.children?.length || 0) > 0
          const isSelectable = !onlyLeafSelection || !hasChildren
          const isKeyboardSelected = enableKeyboardNavigation && selectedIndex === index

          return (
            <TagListRow
              key={tag.id}
              tag={tag}
              isSelected={isSelected}
              isIndeterminate={isIndeterminate}
              hasChildren={hasChildren}
              isSelectable={isSelectable}
              isKeyboardSelected={isKeyboardSelected}
              isManageMode={isManageMode}
              navigateToTag={navigateToTag}
              toggleTag={toggleTag}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )
        })}
      </CommandGroup>
    </ScrollArea>
  )
}
