// apps/web/src/components/tags/ui/tag-picker/tag-picker-content.tsx
'use client'

import {
  DEFAULT_SELECT_OPTION_COLOR,
  getOptionColor,
  type SelectOptionColor,
} from '@auxx/lib/custom-fields/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getNextOptionColor } from '~/components/custom-fields/utils/get-next-option-color'
import { useCreateRecord } from '~/components/resources/hooks/use-create-record'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { TagScopeValue } from '../../types'
import { TagDialog } from '../tag-dialog'
import { CreateTagRow } from './create-tag-row'
import { ManageActions } from './manage-actions'
import { TagList } from './tag-list-row'
import type { Tag, TagNavigationItem } from './types'

interface TagPickerContentProps {
  selectedTags: string[]
  indeterminateTags: string[]
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
  scope: TagScopeValue
  canCreate: boolean
  refresh: () => void
}

/**
 * Inner content component that has access to CommandNavigation context.
 * Owns search, navigation, manage-mode state, edit/delete plumbing,
 * and inline create.
 */
export function TagPickerContent({
  selectedTags,
  indeterminateTags,
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
  scope,
  canCreate,
  refresh,
}: TagPickerContentProps) {
  const {
    current,
    push,
    pop,
    handleKeyDown: handleNavKeyDown,
  } = useCommandNavigation<TagNavigationItem>()
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [isCreating, setIsCreating] = useState(false)
  const [isManageMode, setIsManageMode] = useState(false)
  const [editTagId, setEditTagId] = useState<RecordId | null>(null)

  const [createEmoji, setCreateEmoji] = useState<string>('')
  const [createColor, setCreateColor] = useState<SelectOptionColor>(DEFAULT_SELECT_OPTION_COLOR)
  const [createParentId, setCreateParentId] = useState<string | null>(null)

  const usedColors = useMemo<SelectOptionColor[]>(
    () => flatTags.map((t) => t.tag_color).filter((c): c is string => !!c) as SelectOptionColor[],
    [flatTags]
  )

  const utils = api.useUtils()
  const { canEditEntity, can } = useAccess()

  // Tags are records, so the picker's manage affordances must ask what the
  // server asks: `record.create`/`.update` assert `assertEditEntity` on the tag
  // def, and `record.delete` additionally asserts `recordsDelete`. This surface
  // had NO capability check at all — every member saw create/edit/delete for
  // org-wide tags and found out on the 403. `canCreate` is a caller-supplied
  // layout prop defaulted to `true`, not an authorization signal.
  const canManageTags = !!tagEntityDefinitionId && canEditEntity(tagEntityDefinitionId)
  // A member at records `Edit` holds edit but NOT delete (the delete verb sits on
  // the `Full` rung), so these two are genuinely separable.
  const canDeleteTags = canManageTags && can(PermissionKey.recordsDelete)

  const [confirm, ConfirmDialog] = useConfirm()
  // Canonical create hook — seeds caches + toasts on error. The tree reads from
  // `record.listAll`, so `refresh()` still pulls the new tag into the list.
  const { create: createTag } = useCreateRecord({
    entityDefinitionId: tagEntityDefinitionId ?? '',
  })
  const deleteMutation = api.record.delete.useMutation({
    onSuccess: () => {
      utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
      refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete tag', description: error.message })
    },
  })

  const extractTagId = useCallback(
    (idOrRecordId: string): string => {
      if (!tagEntityDefinitionId) return idOrRecordId
      if (idOrRecordId.includes(':')) {
        const { entityInstanceId } = parseRecordId(idOrRecordId as RecordId)
        return entityInstanceId
      }
      return idOrRecordId
    },
    [tagEntityDefinitionId]
  )

  const toTagRecordId = useCallback(
    (tagId: string): string => {
      if (!tagEntityDefinitionId) return tagId
      return toRecordId(tagEntityDefinitionId, tagId)
    },
    [tagEntityDefinitionId]
  )

  const selectedTagIds = useMemo(() => {
    return selectedTags.map(extractTagId)
  }, [selectedTags, extractTagId])

  const indeterminateTagIds = useMemo(() => {
    return indeterminateTags.map(extractTagId)
  }, [indeterminateTags, extractTagId])

  /** Find children of a tag by traversing the hierarchy tree */
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

  const tagsToDisplay = useMemo((): Tag[] => {
    if (search && flatTags.length > 0) {
      return flatTags.filter(
        (tag) =>
          tag.title.toLowerCase().includes(search.toLowerCase()) || tag.tag_emoji?.includes(search)
      )
    }

    if (!current) {
      return tagHierarchy
    }

    const children = findChildren(tagHierarchy, current.id)
    return children || []
  }, [search, flatTags, current, tagHierarchy, findChildren])

  // Whether the typed search exactly matches an existing tag title
  const searchMatchesExisting = useMemo(() => {
    if (!search.trim()) return true
    const q = search.toLowerCase().trim()
    return flatTags.some((t) => t.title.toLowerCase() === q)
  }, [flatTags, search])

  const showCreateRow =
    canCreate &&
    canManageTags &&
    !isManageMode &&
    !!tagEntityDefinitionId &&
    !!search.trim() &&
    !searchMatchesExisting

  // Auto-assign the next non-conflicting color when the create row first appears.
  // biome-ignore lint/correctness/useExhaustiveDependencies: usedColors intentionally read only on toggle, not every tag-list change
  useEffect(() => {
    if (showCreateRow) {
      setCreateColor(getNextOptionColor(usedColors))
    }
  }, [showCreateRow])

  const handleCreate = useCallback(async () => {
    if (!tagEntityDefinitionId) return
    const title = search.trim()
    if (!title || isCreating) return
    setIsCreating(true)
    try {
      const values: Record<string, unknown> = {
        title,
        tag_emoji: createEmoji || null,
        tag_color: createColor || null,
        tag_scope: scope,
      }
      if (createParentId) {
        values.tag_parent = [toRecordId(tagEntityDefinitionId, createParentId)]
      }

      const result = await createTag({ values })
      const newRecordId = toRecordId(tagEntityDefinitionId, result.instanceId)
      onChange([...selectedTagIds.map(toTagRecordId), newRecordId])
      refresh()
      setSearch('')
      setCreateEmoji('')
      setCreateColor(DEFAULT_SELECT_OPTION_COLOR)
      setCreateParentId(null)
    } finally {
      setIsCreating(false)
    }
  }, [
    tagEntityDefinitionId,
    search,
    isCreating,
    createEmoji,
    createColor,
    createParentId,
    scope,
    createTag,
    onChange,
    selectedTagIds,
    toTagRecordId,
    refresh,
    setSearch,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies: tagsToDisplay triggers index reset when tag list changes
  useEffect(() => {
    setSelectedIndex(-1)
  }, [tagsToDisplay])

  const navigateToTag = useCallback(
    (tag: Tag) => {
      if (!tag.children?.length) return
      push({ ...tag, label: tag.title })
      setSelectedIndex(-1)
    },
    [push]
  )

  const toggleTag = useCallback(
    (tag: Tag) => {
      if (tag.children?.length && onlyLeafSelection) {
        navigateToTag(tag)
        return
      }

      if (selectedTagIds.includes(tag.id)) {
        const newTagIds = selectedTagIds.filter((id) => id !== tag.id)
        onChange(newTagIds.map(toTagRecordId))
      } else {
        if (!allowMultiple) {
          onChange([toTagRecordId(tag.id)])
          onOpenChange(false)
        } else {
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

  const handleEdit = useCallback(
    (tag: Tag) => {
      if (!tagEntityDefinitionId) return
      setEditTagId(toRecordId(tagEntityDefinitionId, tag.id))
    },
    [tagEntityDefinitionId]
  )

  const handleDelete = useCallback(
    async (tag: Tag) => {
      if (!tagEntityDefinitionId) return
      const confirmed = await confirm({
        title: 'Delete tag?',
        description:
          'This will permanently delete the tag from all records. This action cannot be undone.',
        confirmText: 'Delete Tag',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      await deleteMutation.mutateAsync({
        recordId: toRecordId(tagEntityDefinitionId, tag.id),
      })
      // If we just deleted the folder we were inside, pop the stack so we don't
      // end up viewing children of a non-existent parent.
      if (current && current.id === tag.id) pop()
    },
    [confirm, deleteMutation, tagEntityDefinitionId, current, pop]
  )

  const handleEditSaved = useCallback(() => {
    utils.record.listAll.invalidate({ entityDefinitionId: 'tag' })
    refresh()
    setEditTagId(null)
  }, [utils, refresh])

  const selectedItem = useMemo(() => {
    if (selectedIndex < 0 || selectedIndex >= tagsToDisplay.length) return null
    const tag = tagsToDisplay[selectedIndex]
    return tag ? { ...tag, label: tag.title } : null
  }, [selectedIndex, tagsToDisplay])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && showCreateRow && selectedIndex < 0) {
        e.preventDefault()
        handleCreate()
        return
      }

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
          if (!tag) return
          if (isManageMode) {
            if (tag.children?.length) navigateToTag(tag)
            return
          }
          toggleTag(tag)
        },
      })

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
    [
      handleNavKeyDown,
      selectedItem,
      tagsToDisplay,
      toggleTag,
      onOpenChange,
      showCreateRow,
      selectedIndex,
      handleCreate,
      isManageMode,
      navigateToTag,
    ]
  )

  // Manage mode hosts edit and delete, so it needs the edit capability at minimum.
  const canShowManageToggle = canManageTags && flatTags.length > 0

  return (
    <>
      <Command shouldFilter={false} onKeyDown={handleKeyDown}>
        <CommandInput
          placeholder='Search or create tags...'
          value={search}
          onValueChange={setSearch}
          autoFocus
        />

        <CommandBreadcrumb rootLabel='All Tags' />

        <CommandList>
          {current && isManageMode && tagEntityDefinitionId && (
            <>
              <CommandGroup>
                <CommandItem
                  value={`__current__:${current.id}`}
                  onSelect={() => {}}
                  className='px-2 rounded-full flex items-center gap-2'>
                  {current.tag_emoji ? (
                    <span>{current.tag_emoji}</span>
                  ) : (
                    <div
                      className={cn(
                        'size-3 rounded-full shrink-0',
                        getOptionColor((current.tag_color || 'gray') as SelectOptionColor).swatch
                      )}
                    />
                  )}
                  <span className='font-medium truncate'>{current.title}</span>
                  <span className='text-[10px] text-muted-foreground'>(this folder)</span>
                  <ManageActions
                    alwaysVisible
                    canDelete={canDeleteTags}
                    onEdit={() => handleEdit(current)}
                    onDelete={() => handleDelete(current)}
                  />
                </CommandItem>
              </CommandGroup>
              <div className='-mx-1 h-px bg-border/50' />
            </>
          )}

          {current && !isManageMode && !onlyLeafSelection && !search && (
            <>
              <CommandGroup>
                <CommandItem
                  value={`__current__:${current.id}`}
                  onSelect={() => toggleTag(current)}
                  className='px-2 rounded-full flex items-center gap-2'>
                  {current.tag_emoji ? (
                    <span>{current.tag_emoji}</span>
                  ) : (
                    <div
                      className={cn(
                        'size-3 rounded-full shrink-0',
                        getOptionColor((current.tag_color || 'gray') as SelectOptionColor).swatch
                      )}
                    />
                  )}
                  <span className='font-medium truncate'>{current.title}</span>
                  <span className='text-[10px] text-muted-foreground'>(this folder)</span>
                  <Checkbox
                    checked={
                      selectedTagIds.includes(current.id)
                        ? true
                        : indeterminateTagIds.includes(current.id)
                          ? 'indeterminate'
                          : false
                    }
                    aria-label={`Select ${current.title}`}
                    className='ml-auto pointer-events-none'
                  />
                </CommandItem>
              </CommandGroup>
              <div className='-mx-1 h-px bg-border/50' />
            </>
          )}

          {showCreateRow && tagEntityDefinitionId && (
            <>
              <CommandGroup>
                <CreateTagRow
                  search={search}
                  flatTags={flatTags}
                  emoji={createEmoji}
                  setEmoji={setCreateEmoji}
                  color={createColor}
                  setColor={setCreateColor}
                  parentId={createParentId}
                  setParentId={setCreateParentId}
                  isCreating={isCreating}
                  handleCreate={handleCreate}
                />
              </CommandGroup>
              <div className='-mx-1 h-px bg-border/50' />
            </>
          )}

          {isLoading ? (
            <CommandLoading>Loading tags…</CommandLoading>
          ) : !Array.isArray(tagsToDisplay) ? (
            <CommandEmpty>Error loading tags or invalid data.</CommandEmpty>
          ) : tagsToDisplay.length === 0 ? (
            showCreateRow ? null : (
              <CommandEmpty>No tags found.</CommandEmpty>
            )
          ) : (
            <TagList
              tags={tagsToDisplay}
              selectedTags={selectedTagIds}
              indeterminateTags={indeterminateTagIds}
              onlyLeafSelection={onlyLeafSelection}
              toggleTag={toggleTag}
              navigateToTag={navigateToTag}
              selectedIndex={selectedIndex}
              enableKeyboardNavigation={true}
              isManageMode={isManageMode}
              onEdit={handleEdit}
              onDelete={handleDelete}
              canDelete={canDeleteTags}
            />
          )}
        </CommandList>

        {canShowManageToggle && (
          <div className='border-t border-border/50'>
            <CommandGroup>
              <CommandItem
                onSelect={() => setIsManageMode((v) => !v)}
                className='cursor-pointer h-7.5'>
                {isManageMode ? (
                  <>
                    <Check className='text-good-500' />
                    <span>Done</span>
                  </>
                ) : (
                  <>
                    <Settings className='text-muted-foreground' />
                    <span>Manage tags</span>
                  </>
                )}
              </CommandItem>
            </CommandGroup>
          </div>
        )}
      </Command>

      {editTagId && (
        <TagDialog
          open
          onOpenChange={(open) => !open && setEditTagId(null)}
          recordId={editTagId}
          onSaved={handleEditSaved}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
