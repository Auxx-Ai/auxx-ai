// apps/web/src/components/tags/ui/tags-list.tsx
'use client'

import { getOptionColor, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, Edit, Lock, Plus, SearchIcon, Trash } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { api } from '~/trpc/react'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'
import { filterHierarchy } from '../utils/hierarchy'
import { TagDialog } from './tag-dialog'

/**
 * Tag tree view component for settings page.
 * Displays hierarchical list of tags with CRUD operations.
 */
export function TagTreeView() {
  const [confirm, ConfirmDialog] = useConfirm()

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  // Search query from URL (persists across refreshes)
  const [searchQuery, setSearchQuery] = useQueryState('q', { defaultValue: '' })

  // State for tag operations
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({})
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<RecordId | undefined>(undefined)

  // Fetch tag hierarchy
  const { hierarchy: tagHierarchy, isLoading, refresh, entityDefinitionId } = useTagHierarchy()

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete tag', description: error.message })
    },
  })

  // Filter tags based on search query
  const filterTags = useCallback((tags: TagNode[], query: string): TagNode[] => {
    if (!query) return tags
    const { filtered } = filterHierarchy(tags, query)
    return filtered
  }, [])

  const filteredTags = searchQuery ? filterTags(tagHierarchy || [], searchQuery) : tagHierarchy

  // Auto-expand parent tags when search is active
  // biome-ignore lint/correctness/useExhaustiveDependencies: expandedTags is intentionally excluded to avoid infinite loop
  useEffect(() => {
    if (searchQuery && tagHierarchy) {
      const collectMatchingParentIds = (tags: TagNode[]): string[] => {
        let parentIds: string[] = []

        tags.forEach((tag) => {
          if (filterTags([tag], searchQuery).length > 0) {
            parentIds.push(tag.id)
            if (tag.children?.length) {
              parentIds = [...parentIds, ...collectMatchingParentIds(tag.children)]
            }
          }
        })

        return parentIds
      }

      const matchingParentIds = collectMatchingParentIds(tagHierarchy)
      const newExpandedState = { ...expandedTags }

      matchingParentIds.forEach((id) => {
        newExpandedState[id] = true
      })

      setExpandedTags(newExpandedState)
    }
  }, [searchQuery, tagHierarchy, filterTags])

  /** Toggle expanded state for a tag */
  const toggleExpanded = (tagId: string) => {
    setExpandedTags((prev) => ({ ...prev, [tagId]: !prev[tagId] }))
  }

  /** Open dialog for editing a tag */
  const handleEditTag = (tag: TagNode) => {
    if (entityDefinitionId) {
      setEditingRecordId(toRecordId(entityDefinitionId, tag.id))
      setIsDialogOpen(true)
    }
  }

  /** Open dialog for creating a new tag */
  const handleCreateTag = () => {
    setEditingRecordId(undefined)
    setIsDialogOpen(true)
  }

  /** Handle tag deletion */
  const handleDeleteTag = async (tag: TagNode) => {
    if (!entityDefinitionId) return

    if (tag.children?.length > 0) {
      await confirm({
        title: 'Cannot Delete Tag',
        description: 'This tag has child tags. You must move or delete its children first.',
        confirmText: 'OK',
        cancelText: undefined,
        destructive: false,
      })
      return
    }

    const confirmed = await confirm({
      title: 'Delete tag?',
      description: `Are you sure you want to delete the tag "${tag.title}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteRecord.mutate({ recordId: tag.recordId })
    }
  }

  /** Recursive component to render tag tree */
  const TagTreeItem = ({ tag, depth = 0 }: { tag: TagNode; depth?: number }) => {
    const hasChildren = tag.children?.length > 0
    const isExpanded = expandedTags[tag.id]

    return (
      <div className='select-none'>
        <div
          className={cn(
            'flex items-center rounded-2xl ps-0.5 pe-1 py-0.5 ring-1 ring-transparent hover:ring-primary-200',
            'transition-colors duration-200',
            'hover:bg-primary-100/80'
          )}>
          {/* Expand/collapse button */}
          <Button
            variant='ghost'
            size='icon-sm'
            className={cn(
              'rounded-full hover:bg-muted/80',
              hasChildren ? 'text-foreground ' : 'text-transparent'
            )}
            onClick={() => hasChildren && toggleExpanded(tag.id)}
            tabIndex={hasChildren ? 0 : -1}>
            {hasChildren && (isExpanded ? <ChevronDown /> : <ChevronRight />)}
          </Button>

          {/* Tag content */}
          <div
            className='ml-1 flex flex-1 cursor-pointer items-center'
            onClick={() => hasChildren && toggleExpanded(tag.id)}>
            <div
              className={cn(
                'size-7 mr-2 flex items-center justify-center rounded-full shrink-0',
                getOptionColor((tag.tag_color || 'gray') as SelectOptionColor).swatch
              )}>
              {tag.tag_emoji && <span className='shrink-0'>{tag.tag_emoji}</span>}
            </div>

            <span className='font-medium shrink-0'>{tag.title}</span>

            {tag.isSystemTag && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock
                    size={12}
                    className='ml-1.5 shrink-0 text-muted-foreground'
                    aria-label='System tag'
                  />
                </TooltipTrigger>
                <TooltipContent>System tag — managed by Auxx, read-only.</TooltipContent>
              </Tooltip>
            )}

            {tag.tag_description && (
              <span className='ml-2 truncate text-sm text-muted-foreground'>
                {tag.tag_description}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className='flex space-x-1'>
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              disabled={tag.isSystemTag}
              onClick={(e) => {
                e.stopPropagation()
                handleEditTag(tag)
              }}>
              <Edit size={14} />
              <span className='sr-only'>Edit</span>
            </Button>

            <Button
              type='button'
              variant='destructive-hover'
              size='icon-xs'
              className='border-transparent bg-transparent'
              disabled={tag.isSystemTag}
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteTag(tag)
              }}>
              <Trash size={14} />
              <span className='sr-only'>Delete</span>
            </Button>
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className='ml-4 mt-0 border-l border-l-border pl-2'>
            {tag.children.map((child) => (
              <TagTreeItem key={child.id} tag={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  /** Skeleton for a single tag row */
  const TagItemSkeleton = ({ hasChildren = false }: { hasChildren?: boolean }) => (
    <div className='select-none'>
      <div className='flex items-center rounded-2xl ps-0.5 pe-1 py-0.5'>
        <Skeleton className='h-7 w-7 rounded-full shrink-0' />
        <Skeleton className='ml-2 h-3 w-3 rounded-full shrink-0' />
        <Skeleton className='ml-2 h-4 w-24 shrink-0' />
        <Skeleton className='ml-2 h-4 w-40' />
        <div className='ml-auto flex space-x-1'>
          <Skeleton className='h-6 w-6 rounded' />
          <Skeleton className='h-6 w-6 rounded' />
        </div>
      </div>
      {hasChildren && (
        <div className='ml-4 mt-0 border-l border-l-border pl-2'>
          <TagItemSkeleton />
          <TagItemSkeleton />
        </div>
      )}
    </div>
  )

  // Loading state
  if (isLoading) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center space-x-2'>
          <div className='relative flex-1'>
            <Skeleton className='h-8 w-full' />
          </div>
          <Skeleton className='h-8 w-[106px]' />
        </div>
        <div className='rounded-[20px] border p-1'>
          <TagItemSkeleton hasChildren />
          <TagItemSkeleton />
          <TagItemSkeleton hasChildren />
          <TagItemSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Search and action bar */}
      <div className='flex items-center space-x-2'>
        <div className='relative flex-1'>
          <SearchIcon className='absolute left-2.5 top-2 h-4 w-4 text-muted-foreground' />
          <Input
            type='search'
            placeholder='Search tags...'
            className='pl-8'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Button variant='outline' onClick={handleCreateTag}>
          <Plus />
          <span className='hidden sm:inline'>Add Tag</span>
        </Button>
      </div>

      {/* Tag tree */}
      <div className='rounded-[20px] border p-1'>
        {filteredTags?.length ? (
          filteredTags.map((tag) => <TagTreeItem key={tag.id} tag={tag} />)
        ) : (
          <div className='py-8 text-center text-muted-foreground'>
            {searchQuery ? (
              <p>No tags match your search. Try a different query or clear the search.</p>
            ) : (
              <p>No tags found. Create your first tag to get started.</p>
            )}
          </div>
        )}
      </div>

      {/* Tag dialog for creating/editing */}
      <TagDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        recordId={editingRecordId}
        onSaved={() => {
          refresh()
          setEditingRecordId(undefined)
        }}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog />
    </div>
  )
}
