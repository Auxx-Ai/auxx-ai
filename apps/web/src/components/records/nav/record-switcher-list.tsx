// apps/web/src/components/records/nav/record-switcher-list.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { RecordPickerItem } from '@auxx/lib/resources/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPlaceholder,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { MainPageBreadcrumbDropdown } from '@auxx/ui/components/main-page'
import { keepPreviousData } from '@tanstack/react-query'
import { ArrowLeft, ListFilter, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import type { TableView } from '~/components/dynamic-table/types'
import { RecordItem } from '~/components/pickers/record-picker/record-item'
import { useRelationship, useResource } from '~/components/resources'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { RecordEditorDialog } from '../record-editor-dialog'
import type { RecordNavContext } from './use-record-nav-context'

/** How many rows to render at once. Grows as the user scrolls. */
const RENDER_WINDOW = 60
/** Max rows a search returns — searching narrows, so this is generous. */
const SEARCH_LIMIT = 50

/**
 * Height cap for the scrolling row area.
 *
 * Passed as `scrollAreaStyle` rather than a Tailwind class on purpose: a
 * `max-h-[…]` arbitrary value cannot express `calc()` without underscore
 * escaping, and an invalid arbitrary value is worse than none — tailwind-merge
 * still drops `CommandList`'s default `max-h-[300px]` for it, leaving the
 * popover with no cap at all and rendering full height.
 *
 * The Radix variable clamps the list on short viewports; the `100vh` fallback
 * keeps the expression valid if the popover ever renders outside a Radix
 * popper, and the 320px floor is what it settles at on a normal screen.
 */
const listHeightStyle = (headerAllowance: string) => ({
  maxHeight: `min(320px, calc(var(--radix-popover-content-available-height, 100vh) - ${headerAllowance}))`,
})

interface RecordSwitcherListProps {
  context: RecordNavContext
  /** The record whose detail page is open. */
  activeRecordId: RecordId
  /** Its display name — the breadcrumb trigger label. */
  activeLabel: string
}

/**
 * The breadcrumb record switcher: browse, search and jump within the same list
 * the detail page was opened from.
 *
 * Deliberately not built on `RecordPickerContent`, whose rows come only from
 * `record.search` — that procedure takes no filters and no sorting, so it would
 * offer a different set in a different order than the list being walked. What is
 * reused instead is the leaf: {@link RecordItem} (so a record row looks the same
 * here as in every picker) and `useRelationship` for batched hydration.
 */
export function RecordSwitcherList({
  context,
  activeRecordId,
  activeLabel,
}: RecordSwitcherListProps) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const { entityDefinitionId } = parseRecordId(activeRecordId)

  return (
    <>
      <MainPageBreadcrumbDropdown
        label={<span className='max-w-[24ch] truncate'>{activeLabel}</span>}
        popover
        open={open}
        onOpenChange={setOpen}
        align='start'
        contentClassName='w-80 p-0'>
        {/* Radix unmounts popover content when closed, so every query below
            only runs while the switcher is actually open. */}
        <SwitcherBody
          context={context}
          activeRecordId={activeRecordId}
          onClose={() => setOpen(false)}
          onCreate={() => {
            setOpen(false)
            setCreateOpen(true)
          }}
        />
      </MainPageBreadcrumbDropdown>

      {/* Sibling of the popover, which has already closed itself by now — the
          same arrangement DashboardSwitcherList uses for its settings dialog. */}
      {createOpen && (
        <RecordEditorDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          entityDefinitionId={entityDefinitionId}
        />
      )}
    </>
  )
}

function SwitcherBody({
  context,
  activeRecordId,
  onClose,
  onCreate,
}: {
  context: RecordNavContext
  activeRecordId: RecordId
  onClose: () => void
  onCreate: () => void
}) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(activeRecordId)
  const { resource } = useResource(entityDefinitionId)
  const { canEditEntity } = useAccess()
  const canEdit = canEditEntity(entityDefinitionId)

  const [mode, setMode] = useState<'records' | 'views'>('records')
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const [visibleCount, setVisibleCount] = useState(RENDER_WINDOW)

  const { descriptor, ids, loadMore, hasMore, isLoadingMore, total, isReconstructed, selectView } =
    context

  // ─── SEARCH WITHIN THE LIST ──────────────────────────────────────────────
  // `record.search` is deliberately not used: it accepts no filters, so it would
  // surface records outside the list being walked. ANDing a `contains` condition
  // onto the descriptor's own filters keeps results a strict subset, under the
  // same access scoping and the same query path.
  const primaryFieldId = resource?.display?.primaryDisplayField?.id
  const query = debouncedSearch.trim()

  const searchFilters = useMemo((): ConditionGroup[] | undefined => {
    if (!query || !primaryFieldId) return undefined
    return [
      ...descriptor.filters,
      {
        id: 'nav-search',
        logicalOperator: 'AND',
        conditions: [
          { id: 'nav-search-q', fieldId: primaryFieldId, operator: 'contains', value: query },
        ],
      } as ConditionGroup,
    ]
  }, [query, primaryFieldId, descriptor.filters])

  const searchQuery = api.record.listFiltered.useQuery(
    {
      entityDefinitionId: descriptor.entityDefinitionId,
      filters: searchFilters,
      sorting: descriptor.sorting.length > 0 ? descriptor.sorting : undefined,
      limit: SEARCH_LIMIT,
    },
    {
      enabled: !!searchFilters,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )

  const isSearching = !!searchFilters && (searchQuery.isFetching || search !== debouncedSearch)
  const listIds = searchFilters ? (searchQuery.data?.ids ?? []) : ids

  // Reset the render window whenever the row source changes under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on source change, not on row growth
  useEffect(() => {
    setVisibleCount(RENDER_WINDOW)
  }, [query, descriptor.viewId])

  // ─── HYDRATION ───────────────────────────────────────────────────────────
  // The active record leads, so its row renders even when it is not in the list
  // (filtered out after an edit, or opened from outside the list entirely).
  const visibleIds = useMemo(() => listIds.slice(0, visibleCount), [listIds, visibleCount])

  const recordIdsToHydrate = useMemo(() => {
    const out: RecordId[] = [activeRecordId]
    for (const id of visibleIds) {
      if (id !== entityInstanceId) out.push(toRecordId(entityDefinitionId, id))
    }
    return out
  }, [activeRecordId, visibleIds, entityInstanceId, entityDefinitionId])

  const { itemsMap, isLoading: isHydrating } = useRelationship(recordIdsToHydrate)

  const activeItem = itemsMap.get(entityInstanceId) ?? null
  const rows = useMemo(() => {
    const out: RecordPickerItem[] = []
    for (const id of visibleIds) {
      if (id === entityInstanceId) continue
      const item = itemsMap.get(id)
      if (item) out.push(item)
    }
    return out
  }, [visibleIds, itemsMap, entityInstanceId])

  // ─── INFINITE SCROLL ─────────────────────────────────────────────────────
  // Grow the render window first; only ask the server once every loaded id is
  // on screen. Searching has its own single page, so it never pages.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onReachEnd = useCallback(() => {
    if (searchFilters) return
    if (visibleCount < listIds.length) {
      setVisibleCount((c) => c + RENDER_WINDOW)
      return
    }
    if (hasMore) loadMore()
  }, [searchFilters, visibleCount, listIds.length, hasMore, loadMore])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReachEnd()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onReachEnd])

  // ─── VIEW SWITCHING ──────────────────────────────────────────────────────
  // Rendered as a mode of the same Command rather than a nested dropdown: a
  // second Radix portal over a cmdk body is exactly the arrow-key fight the
  // popover host exists to avoid.
  const views = useDynamicTableStore((s) => s.viewsByTableId[descriptor.tableId])
  const availableViews = views ?? []

  const goTo = context.goTo
  const handlePick = useCallback(
    (recordId: RecordId) => {
      const { entityInstanceId: target } = parseRecordId(recordId)
      onClose()
      // Reuse the context's own navigation so `?tab=` / `?list=` survive the hop
      // exactly as they do for the arrows.
      if (target !== entityInstanceId) goTo(target)
    },
    [entityInstanceId, onClose, goTo]
  )

  if (mode === 'views') {
    return (
      <Command shouldFilter={false} className='overflow-hidden rounded-2xl'>
        <div className='flex items-center gap-1 border-b px-2 py-1.5'>
          <Button variant='ghost' size='icon-sm' onClick={() => setMode('records')}>
            <ArrowLeft />
          </Button>
          <span className='text-xs font-medium text-muted-foreground'>Switch list</span>
        </div>
        <CommandList scrollAreaStyle={listHeightStyle('5rem')}>
          {availableViews.length === 0 ? (
            <CommandPlaceholder>No saved views</CommandPlaceholder>
          ) : (
            <CommandGroup aria-label='Saved views'>
              {availableViews.map((view: TableView) => (
                <CommandItem
                  key={view.id}
                  value={view.id}
                  onSelect={() => {
                    selectView(view)
                    setMode('records')
                  }}>
                  <ListFilter />
                  <span className='truncate'>{view.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    )
  }

  return (
    <Command shouldFilter={false} className='overflow-hidden rounded-2xl'>
      <div className='flex items-center justify-between gap-2 border-b px-3 py-1.5'>
        <span className='min-w-0 truncate text-xs text-muted-foreground'>
          {isReconstructed ? 'Showing' : 'From'}{' '}
          <span className='font-medium text-foreground'>{descriptor.label}</span>
        </span>
        {availableViews.length > 0 && (
          <Button
            variant='ghost'
            size='sm'
            className='h-6 px-1.5 text-xs'
            onClick={() => setMode('views')}>
            Switch
          </Button>
        )}
      </div>

      <CommandInput
        placeholder='Search in this list...'
        value={search}
        onValueChange={setSearch}
        loading={isSearching}
      />

      {/* Header + input + pinned create footer are all outside this scroller, so
          the allowance below keeps the popover inside the viewport on a short
          screen instead of pushing the create row off it. */}
      <CommandList scrollAreaStyle={listHeightStyle('9rem')}>
        {activeItem && !searchFilters && (
          <>
            <CommandGroup aria-label='Current record'>
              <RecordItem
                item={activeItem}
                isSelected
                multi={false}
                onToggle={() => onClose()}
                showSecondary
              />
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {rows.length === 0 && !isHydrating && !isSearching && (
          <CommandPlaceholder>
            {searchFilters ? 'No matches in this list' : 'No other records'}
          </CommandPlaceholder>
        )}

        {rows.length > 0 && (
          <CommandGroup aria-label='Records'>
            {rows.map((item) => (
              <RecordItem
                key={item.recordId}
                item={item}
                isSelected={false}
                multi={false}
                onToggle={handlePick}
                showSecondary
              />
            ))}
          </CommandGroup>
        )}

        {/* Scroll sentinel — grows the render window, then pages the server. */}
        <div ref={sentinelRef} aria-hidden className='h-px' />

        {!searchFilters && (
          <div className='px-3 py-1.5 text-xs text-muted-foreground'>
            {isLoadingMore
              ? 'Loading…'
              : hasMore || listIds.length < total
                ? `Showing ${Math.min(visibleCount, listIds.length)} of ${total}`
                : `${listIds.length} record${listIds.length === 1 ? '' : 's'}`}
          </div>
        )}
      </CommandList>

      {/* Pinned OUTSIDE CommandList: the list scrolls to hundreds of rows, so a
          nested create row (as the record picker and EntitySwitcherList both
          have) would be unreachable at the bottom of the scroller.

          NOTE: cmdk scopes its item registry to the list element, so this item is
          not reached by arrow keys or `End` — `End` lands on the last row inside
          the scroller. Click works (CommandItem binds its own onClick). If the
          keyboard gap matters, swap this for a plain `<button>`, which is at
          least Tab-focusable. */}
      {canEdit && resource && (
        <CommandGroup aria-label='Create' className='border-t'>
          <CommandItem value='__create__' onSelect={onCreate}>
            <Plus />
            Create {resource.label}
          </CommandItem>
        </CommandGroup>
      )}
    </Command>
  )
}
