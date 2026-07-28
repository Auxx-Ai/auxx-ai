// apps/web/src/components/pickers/entity-switcher-list.tsx
'use client'

import type { FavoriteTargetIdsMap, FavoriteTargetType } from '@auxx/lib/favorites/client'
import { favoriteTargetKey } from '@auxx/lib/favorites/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPlaceholder,
} from '@auxx/ui/components/command'
import { RowSlideActions } from '@auxx/ui/components/row-slide-actions'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import type * as React from 'react'
import { useMemo, useState } from 'react'
import { useFavoritesStore } from '~/components/favorites/store/favorites-store'
import { FavoriteStarButton } from '~/components/favorites/ui/favorite-star-button'
import { useConfirm } from '~/hooks/use-confirm'

/** Group id used by the default Favorites/All partition. */
const FAVORITES_GROUP_ID = '__favorites__'
/** Group id used by the default Favorites/All partition. */
const ALL_GROUP_ID = '__all__'

/**
 * One row in an {@link EntitySwitcherList}.
 *
 * `id` is always the real cuid — it is the permission key and the cmdk value —
 * even for entities that are routed by slug (agents). Routing lives on `href`.
 */
export interface EntitySwitcherItem {
  /** The real cuid. Always the permission key — never a slug. */
  id: string
  label: string
  /** Route target. Agents pass `/app/agents/${slug}`; everyone else `/app/x/${id}`. */
  href?: string
  /** Leading visual override — `<AgentAvatar>`, `<RecordIcon>`, anything. Wins over `iconId`. */
  icon?: React.ReactNode
  iconId?: string
  color?: string
  /** Inline slot after the label — a status `<Badge>`. */
  secondary?: React.ReactNode
  /** Right-aligned static slot, before the star. */
  trailing?: React.ReactNode
}

/**
 * Props for {@link EntitySwitcherList}.
 *
 * @typeParam T - the favoritable target type, when the entity is favoritable.
 */
export interface EntitySwitcherListProps<T extends FavoriteTargetType = FavoriteTargetType> {
  items: EntitySwitcherItem[]
  activeId?: string
  isLoading?: boolean

  /** Receives the WHOLE item — agents route by slug but key permissions by id. */
  onSelect: (item: EntitySwitcherItem) => void

  /** Opens the feature's own settings dialog/drawer. NOT an inline rename. */
  onEdit?: (item: EntitySwitcherItem) => void
  canEdit?: (item: EntitySwitcherItem) => boolean

  onDelete?: (item: EntitySwitcherItem) => void | Promise<void>
  canDelete?: (item: EntitySwitcherItem) => boolean
  /** Copy for the `useConfirm` dialog. Omit to delete without confirming. */
  deleteConfirm?: (item: EntitySwitcherItem) => { title: string; description: string }

  /** Omit entirely for non-favoritable types (agents, sequences, connectors). */
  favorite?: {
    targetType: T
    targetIds: (item: EntitySwitcherItem) => FavoriteTargetIdsMap[T]
  }

  /** Footer row. */
  onCreate?: () => void
  createLabel?: string

  /** Escape hatch for per-row extras the slots above can't express. */
  renderItemActions?: (item: EntitySwitcherItem) => React.ReactNode

  /**
   * Partition items into headed sections — same contract as `MultiSelectPicker`.
   * Omit to get the default Favorites/All split when `favorite` is supplied, or a
   * single ungrouped list when it isn't.
   */
  groupBy?: (item: EntitySwitcherItem) => string
  /**
   * Group ordering + headings for {@link groupBy}. Ids produced by `groupBy` but
   * missing here are appended after these, in first-seen order, with the raw id
   * as the heading. Groups emptied by search are dropped.
   */
  groups?: Array<{ id: string; heading?: React.ReactNode }>

  /** Set when the list query reports `hasMore` — renders a muted, non-selectable footer notice. */
  truncatedNotice?: React.ReactNode

  searchPlaceholder?: string
  emptyText?: string
  className?: string
}

/**
 * The shared body of every top-level entity switcher: search, select, favorite,
 * edit, and delete over one already-complete list of entities.
 *
 * Filtering is client-side (`shouldFilter={false}` plus an explicit label match)
 * because the list arrives complete in a single query — there is no paging and no
 * server-side search. Edit and delete are gated **per row** via `canEdit` /
 * `canDelete`, so a mixed-ownership list shows the affordances only on the rows
 * the viewer may actually mutate.
 *
 * @example
 * ```tsx
 * <EntitySwitcherList
 *   items={items}
 *   activeId={dashboard.id}
 *   onSelect={(item) => router.push(item.href ?? '/app/dashboards')}
 *   canDelete={(item) => canAdminInstance(toRecordId('dashboard', item.id))}
 *   onDelete={(item) => deleteDashboard(item.id)}
 *   favorite={{ targetType: 'DASHBOARD', targetIds: (item) => ({ dashboardId: item.id }) }}
 * />
 * ```
 */
export function EntitySwitcherList<T extends FavoriteTargetType = FavoriteTargetType>({
  items,
  activeId,
  isLoading = false,
  onSelect,
  onEdit,
  canEdit,
  onDelete,
  canDelete,
  deleteConfirm,
  favorite,
  onCreate,
  createLabel = 'Create new',
  renderItemActions,
  groupBy,
  groups,
  truncatedNotice,
  searchPlaceholder = 'Search...',
  emptyText = 'No results found.',
  className,
}: EntitySwitcherListProps<T>) {
  const [searchValue, setSearchValue] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const favoritesById = useFavoritesStore((s) => s.byId)

  // Client-side filter — the list is complete in one query, so there is nothing
  // to lie about. Ported from `multi-select-picker.tsx:186-190`.
  const filteredItems = useMemo(() => {
    if (!searchValue.trim()) return items
    const search = searchValue.toLowerCase()
    return items.filter((item) => item.label.toLowerCase().includes(search))
  }, [items, searchValue])

  // Every favorited target key the store holds. One pass, reused by every row —
  // `useFavoriteForTarget` is a hook and can't be called per item.
  const favoritedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const fav of Object.values(favoritesById)) {
      if (fav.nodeType !== 'ITEM' || !fav.targetType || !fav.targetIds) continue
      keys.add(
        favoriteTargetKey(fav.targetType, fav.targetIds as FavoriteTargetIdsMap[FavoriteTargetType])
      )
    }
    return keys
  }, [favoritesById])

  // Favorites/All is the default partition for favoritable entities — a handful
  // of pinned rows stay on top no matter how long the list gets. Costs no query:
  // the favorites store is already hydrated client-side.
  const effectiveGroupBy = useMemo(() => {
    if (groupBy) return groupBy
    if (!favorite) return undefined
    return (item: EntitySwitcherItem) =>
      favoritedKeys.has(favoriteTargetKey(favorite.targetType, favorite.targetIds(item)))
        ? FAVORITES_GROUP_ID
        : ALL_GROUP_ID
  }, [groupBy, favorite, favoritedKeys])

  const effectiveGroups = useMemo(() => {
    if (groupBy) return groups
    if (!favorite) return undefined
    return [
      { id: FAVORITES_GROUP_ID, heading: 'Favorites' },
      { id: ALL_GROUP_ID, heading: 'All' },
    ]
  }, [groupBy, groups, favorite])

  // Ordered, headed sections; `null` keeps the single ungrouped list. Group order
  // follows `groups`, then any ids `groupBy` produces that `groups` omits
  // (first-seen). Groups emptied by search are dropped.
  // Ported from `multi-select-picker.tsx:196-212`.
  const groupedItems = useMemo(() => {
    if (!effectiveGroupBy) return null
    const headingById = new Map((effectiveGroups ?? []).map((g) => [g.id, g.heading]))
    const order: string[] = (effectiveGroups ?? []).map((g) => g.id)
    const itemsById = new Map<string, EntitySwitcherItem[]>()
    for (const item of filteredItems) {
      const id = effectiveGroupBy(item)
      if (!itemsById.has(id)) {
        itemsById.set(id, [])
        if (!headingById.has(id)) order.push(id)
      }
      itemsById.get(id)?.push(item)
    }
    return order
      .filter((id) => itemsById.has(id))
      .map((id) => ({ id, heading: headingById.get(id) ?? id, items: itemsById.get(id) ?? [] }))
  }, [effectiveGroupBy, effectiveGroups, filteredItems])

  const handleDelete = async (item: EntitySwitcherItem) => {
    if (!onDelete) return
    const copy = deleteConfirm?.(item)
    if (copy) {
      const ok = await confirm({
        title: copy.title,
        description: copy.description,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!ok) return
    }
    await onDelete(item)
  }

  const renderItem = (item: EntitySwitcherItem) => {
    const showEdit = Boolean(onEdit) && (canEdit?.(item) ?? true)
    const showDelete = Boolean(onDelete) && (canDelete?.(item) ?? true)
    const isFavorited = favorite
      ? favoritedKeys.has(favoriteTargetKey(favorite.targetType, favorite.targetIds(item)))
      : false

    // The star lives in the SLIDE cluster, not the static trailing row. The
    // cluster is anchored to the row's right edge and appears on hover, so
    // anything static there is unreachable by mouse — moving toward it is what
    // summons the thing covering it. A favorited row still needs to read as
    // favorited at rest, so it also gets a plain glyph in `trailing`; the
    // cluster's opaque background hides it on hover, leaving one visible star.
    const staticStar = isFavorited ? (
      <Star className='size-4 shrink-0 fill-amber-400 text-amber-500' aria-hidden />
    ) : null

    return (
      <CommandDetailItem
        key={item.id}
        value={item.id}
        title={item.label}
        icon={item.icon}
        iconId={item.iconId}
        color={item.color}
        iconVariant='tile'
        secondary={item.secondary}
        selected={item.id === activeId}
        selectionMode='check'
        onSelect={() => onSelect(item)}
        className='group/cmd-item relative overflow-hidden h-7 cursor-pointer'
        trailing={
          (item.trailing || staticStar) && (
            <>
              {item.trailing}
              {staticStar}
            </>
          )
        }
        actions={renderItemActions?.(item)}
        slideActions={
          (favorite || showEdit || showDelete) && (
            <RowSlideActions group='cmd-item'>
              {favorite && (
                <FavoriteStarButton
                  targetType={favorite.targetType}
                  targetIds={favorite.targetIds(item)}
                />
              )}
              {showEdit && (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Edit ${item.label}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onEdit?.(item)
                  }}>
                  <Pencil />
                </Button>
              )}
              {showDelete && (
                <Button
                  type='button'
                  variant='destructive-hover'
                  size='icon-xs'
                  aria-label={`Delete ${item.label}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    void handleDelete(item)
                  }}>
                  <Trash2 />
                </Button>
              )}
            </RowSlideActions>
          )
        }
      />
    )
  }

  return (
    <>
      <Command shouldFilter={false} className={cn('rounded-lg', className)}>
        <CommandInput
          placeholder={searchPlaceholder}
          value={searchValue}
          onValueChange={setSearchValue}
        />

        <CommandList>
          {isLoading ? (
            <div className='flex items-center justify-center py-6'>
              <Loader2 className='size-4 animate-spin' />
            </div>
          ) : (
            <>
              {filteredItems.length === 0 && <CommandPlaceholder>{emptyText}</CommandPlaceholder>}

              {groupedItems
                ? groupedItems.map((group) => (
                    <CommandGroup key={group.id} heading={group.heading}>
                      {group.items.map(renderItem)}
                    </CommandGroup>
                  ))
                : filteredItems.length > 0 && (
                    <CommandGroup>{filteredItems.map(renderItem)}</CommandGroup>
                  )}

              {truncatedNotice && (
                <div className='px-3 py-2 text-xs text-muted-foreground'>{truncatedNotice}</div>
              )}

              {onCreate && (
                <CommandGroup>
                  <CommandItem
                    value='__create__'
                    onSelect={onCreate}
                    className='cursor-pointer h-7.5'>
                    <Plus className='text-muted-foreground' />
                    <span>{createLabel}</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </Command>

      <ConfirmDialog />
    </>
  )
}
