// apps/web/src/components/tags/ui/tags-list.tsx
'use client'

import { getOptionColor } from '@auxx/lib/custom-fields/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { AnimatedGradientText } from '@auxx/ui/components/animated-gradient-text'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Edit,
  Lock,
  Plus,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useUser } from '~/hooks/use-user'
import { useRequireEntityEdit } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useTagHierarchy } from '../hooks/use-tag-hierarchy'
import type { TagNode } from '../types'
import { filterHierarchy } from '../utils/hierarchy'
import { SuggestedCategoriesDialog } from './suggested-categories-dialog'
import { TagDialog } from './tag-dialog'

/**
 * Tag tree view component for settings page.
 * Displays hierarchical list of tags with CRUD operations.
 */
export function TagTreeView() {
  const [confirm, ConfirmDialog] = useConfirm()

  useUser({ requireOrganization: true })

  // Search query from URL (persists across refreshes)
  const [searchQuery, setSearchQuery] = useQueryState('q', { defaultValue: '' })

  // State for tag operations
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({})
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSuggestedOpen, setIsSuggestedOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<RecordId | undefined>(undefined)

  // Archived tags are hidden by default and revealed by the toolbar toggle.
  // ⚠️ Without this the archive action would be a ONE-WAY DOOR — an archived tag
  // vanishes from the only surface that manages tags, with no route back. That
  // would be strictly worse than the delete it replaces.
  const [showArchived, setShowArchived] = useQueryState('archived', {
    defaultValue: false,
    parse: (v) => v === '1',
    serialize: (v) => (v ? '1' : ''),
  })

  // Fetch tag hierarchy
  const {
    hierarchy: tagHierarchy,
    isLoading,
    refresh,
    entityDefinitionId,
  } = useTagHierarchy({ includeArchived: showArchived })

  // Tags are RECORDS, not a settings surface: this page creates and deletes them
  // through `record.create`/`record.delete`, which assert `assertEditEntity` on
  // the tag def (plus `recordsDelete` on the delete path). Gating it on
  // `settingsManage` — as it was — named a key the server never checks here,
  // while the tag PICKER on every record offered the same create/edit/delete
  // with no gate at all. This asks the question the server answers.
  useRequireEntityEdit(entityDefinitionId)

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      refresh()
    },
    onError: (error) => {
      // ⚠️ The common failure here is a 409 from `rejectDeleteIfTagInUse`, whose
      // message already names the record count and points at archive. Surfacing
      // `error.message` verbatim is the whole remedy — do not replace it with a
      // generic string.
      toastError({ title: 'Failed to delete tag', description: error.message })
    },
  })

  const archiveRecord = api.record.archive.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => {
      toastError({ title: 'Failed to archive tag', description: error.message })
    },
  })

  const restoreRecord = api.record.restore.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => {
      toastError({ title: 'Failed to restore tag', description: error.message })
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

  /**
   * Archive a tag — the default way to retire one that is in use.
   *
   * Confirmed rather than immediate, despite being reversible: an archived tag
   * leaves the classifier's label set (`labels.ts:92`), so mail that used to get
   * this category silently stops getting it. That is a behaviour change worth one
   * click, and the copy says so.
   */
  const handleArchiveTag = async (tag: TagNode) => {
    const confirmed = await confirm({
      title: 'Archive tag?',
      description: tag.aiClassify
        ? `"${tag.title}" stays on every conversation that already has it, but will no longer be applied to new mail by AI. You can restore it at any time.`
        : `"${tag.title}" stays on every record that already has it, but will no longer be offered when tagging. You can restore it at any time.`,
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: false,
    })

    if (confirmed) {
      archiveRecord.mutate({ recordId: tag.recordId })
    }
  }

  /** Restore an archived tag. Reversible and consequence-free — no confirm. */
  const handleRestoreTag = (tag: TagNode) => {
    restoreRecord.mutate({ recordId: tag.recordId })
  }

  return (
    <div className='flex flex-1 flex-col'>
      <ListToolbar sticky={false}>
        <InputSearch
          value={searchQuery}
          placeholder='Search tags...'
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <ListToolbarGroup align='end'>
          {/* The route back out of archive. Kept beside the create control rather
              than buried in a menu — it is the only way to reach a restore. */}
          <Button
            variant={showArchived ? 'secondary' : 'outline'}
            size='sm'
            onClick={() => setShowArchived(showArchived ? null : true)}>
            <Archive />
            <span className='hidden sm:inline'>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </span>
          </Button>
          {/* Matches the create dropdown on custom-fields: blank first, shipped
              templates second. The suggested categories live here rather than in
              a settings section of their own — they ARE tags, and the list is
              where tags are managed (plan 06 §7.2). */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm'>
                <Plus />
                <span className='hidden sm:inline'>Add Tag</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={handleCreateTag}>
                <Plus /> Blank tag
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsSuggestedOpen(true)}
                className='data-highlighted:bg-[#ffaa40]/10'>
                <Sparkles className='text-[#ffaa40]' />{' '}
                <AnimatedGradientText>Suggested AI categories</AnimatedGradientText>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ListToolbarGroup>
      </ListToolbar>

      <div className='p-3 sm:p-6'>
        {isLoading ? (
          <TreeRowList
            className='gap-0.5'
            items={[]}
            loading
            skeletonCount={6}
            getKey={(_item, i) => String(i)}
            renderRow={() => null}
          />
        ) : filteredTags?.length ? (
          <TreeRowList
            className='gap-0.5'
            items={filteredTags}
            getKey={(tag) => tag.id}
            renderRow={(tag) => (
              <TagTreeItem
                tag={tag}
                expandedTags={expandedTags}
                onToggle={toggleExpanded}
                onEdit={handleEditTag}
                onDelete={handleDeleteTag}
                onArchive={handleArchiveTag}
                onRestore={handleRestoreTag}
              />
            )}
          />
        ) : (
          <EmptyState
            icon={Tags}
            title={searchQuery ? 'No tags match your search' : 'No tags yet'}
            description={
              searchQuery
                ? 'Try a different query or clear the search.'
                : 'Create your first tag to get started.'
            }
            button={
              searchQuery ? undefined : (
                <Button variant='outline' onClick={handleCreateTag}>
                  <Plus />
                  Add Tag
                </Button>
              )
            }
          />
        )}
      </div>

      <SuggestedCategoriesDialog open={isSuggestedOpen} onOpenChange={setIsSuggestedOpen} />

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

interface TagTreeItemProps {
  tag: TagNode
  depth?: number
  expandedTags: Record<string, boolean>
  onToggle: (tagId: string) => void
  onEdit: (tag: TagNode) => void
  onDelete: (tag: TagNode) => void
  onArchive: (tag: TagNode) => void
  onRestore: (tag: TagNode) => void
}

/**
 * Recursive tag row rendered as a {@link TreeRow}. Kept at module scope (not
 * nested inside `TagTreeView`) so its component identity is stable across
 * renders — a nested definition remounts the subtree on every state change,
 * which kills the TreeRow expand/collapse animation.
 */
function TagTreeItem({
  tag,
  depth = 0,
  expandedTags,
  onToggle,
  onEdit,
  onDelete,
  onArchive,
  onRestore,
}: TagTreeItemProps) {
  const hasChildren = tag.children?.length > 0
  const isExpanded = !!expandedTags[tag.id]

  return (
    <TreeRow
      depth={depth}
      rowClassName={cn(
        'bg-primary-50 hover:bg-primary-100',
        // Muted, never hidden: the row is still actionable (restore lives on it),
        // so it reads as retired rather than disabled.
        tag.isArchived && 'opacity-60'
      )}
      icon={
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full text-xs',
            getOptionColor((tag.tag_color || 'gray') as SelectOptionColor).swatch
          )}>
          {tag.tag_emoji}
        </span>
      }
      title={
        // Bare string when there is no badge: TreeRow's own `truncate` ellipsizes
        // inline text, but clips an inline-flex child instead — so only pay that
        // cost on the rows that actually need a badge beside the name.
        !tag.isSystemTag && !tag.aiClassify && !tag.isArchived ? (
          tag.title
        ) : (
          <span className='inline-flex min-w-0 items-center gap-1.5'>
            <span className='truncate'>{tag.title}</span>
            {tag.isArchived && (
              <Tooltip content='Archived. Kept on the records that have it, but no longer offered — or applied by AI.'>
                <span className='shrink-0 rounded border px-1 py-px text-[10px] leading-none text-muted-foreground'>
                  Archived
                </span>
              </Tooltip>
            )}
            {tag.isSystemTag && (
              <Tooltip content='System tag, managed by Auxx. Read-only.'>
                <Lock className='size-3 shrink-0 text-muted-foreground' aria-label='System tag' />
              </Tooltip>
            )}
            {tag.aiClassify && (
              <Tooltip
                content={
                  tag.tag_description
                    ? 'AI may apply this tag to incoming mail.'
                    : 'AI may apply this tag to incoming mail. Add a description so it knows when.'
                }>
                <Sparkles
                  className='size-3 shrink-0 text-primary-500'
                  aria-label='AI may apply this tag'
                />
              </Tooltip>
            )}
          </span>
        )
      }
      description={tag.tag_description || undefined}
      expandable={hasChildren}
      isOpen={isExpanded}
      onToggleOpen={hasChildren ? () => onToggle(tag.id) : undefined}
      actions={
        tag.isSystemTag ? undefined : tag.isArchived ? (
          // An archived row offers only the way back. Editing a retired tag or
          // archiving it twice are both meaningless; delete stays reachable by
          // restoring first, which is one deliberate step rather than a trap.
          <TreeRowButton tooltipText='Restore tag' onClick={() => onRestore(tag)}>
            <ArchiveRestore />
          </TreeRowButton>
        ) : (
          <>
            <TreeRowButton tooltipText='Edit tag' onClick={() => onEdit(tag)}>
              <Edit />
            </TreeRowButton>
            <TreeRowButton tooltipText='Archive tag' onClick={() => onArchive(tag)}>
              <Archive />
            </TreeRowButton>
            <TreeRowButton
              variant='destructive'
              tooltipText='Delete tag'
              onClick={() => onDelete(tag)}>
              <Trash2 />
            </TreeRowButton>
          </>
        )
      }>
      {hasChildren &&
        tag.children.map((child) => (
          <TagTreeItem
            key={child.id}
            tag={child}
            depth={depth + 1}
            expandedTags={expandedTags}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        ))}
    </TreeRow>
  )
}
