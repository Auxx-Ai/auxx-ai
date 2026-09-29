// apps/web/src/components/manufacturing/stock-setup/costs-step.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { ActionBar, type ActionBarAction } from '@auxx/ui/components/action-bar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Command,
  CommandDetailItem,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Check, ChevronDown, ChevronRight, Group, ListFilter, Package } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { Tooltip } from '~/components/global/tooltip'
import {
  ListSelectionProvider,
  SelectAllCheckbox,
  useBulkMode,
  useIsSelected,
  useListSelection,
  useSelectionCount,
  useSelectionIds,
} from '~/components/list-selection'
import { useResourceProperty } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { EditableCell } from '../ui/settings/opening-stock-list'
import { useAccountingSetupState } from './accounting-status-line'
import {
  COST_FILTERS,
  COST_GROUP_BYS,
  type CostFilter,
  type CostGroup,
  type CostGroupBy,
  type CostRow,
  type CostSource,
  groupBySupplier,
  matchesCostFilter,
  parseCostFilter,
  planSourceAction,
  SOURCE_ORIGIN,
  type SourcePlan,
  sortCostRows,
  sourceActionCount,
  sourcePlanLine,
  toCostRow,
  waitingProducts,
} from './costs-model'
import type { StockSetupStatus } from './use-stock-setup'

const PAGE_SIZE = 50
/** `builds.setStandardCosts` takes at most this many items per call. */
const COST_CHUNK = 500
/** Columns: part | used in | suggested | cost | state. */
const COLS = 'minmax(8rem, 1fr) 5.5rem minmax(8rem, 10rem) minmax(7rem, 8rem) minmax(11rem, 13rem)'
/** The list's `p-3`, which `SelectAllCheckbox` aligns its box against. */
const LIST_PADDING = 12

const ORIGIN_LABEL: Record<string, string> = {
  supplier_price: 'supplier',
  channel: 'channel',
  receipt: 'receipt',
  manual: 'typed',
  roll: 'rolled',
  opening_stock: 'count',
}

const SOURCE_LABEL: Record<CostSource, string> = {
  supplier: 'Use supplier cost',
  channel: 'Use channel cost',
  current: 'Confirm current',
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface CostsStepProps {
  status: StockSetupStatus | undefined
  onChanged: () => void
}

/** Stock setup step 2 (plans/mrp/22 §3): a cost for every part you buy, before past builds. */
export function CostsStep(props: CostsStepProps) {
  return (
    <ListSelectionProvider>
      <CostsStepInner {...props} />
    </ListSelectionProvider>
  )
}

function CostsStepInner({ status, onChanged }: CostsStepProps) {
  const utils = api.useUtils()
  const worklist = api.builds.standardCostWorklist.useQuery({}, { staleTime: 30_000 })
  const setCosts = api.builds.setStandardCosts.useMutation()
  const confirmCosts = api.builds.confirmStandardCosts.useMutation()
  const setFlag = api.purchasing.setStockSetupFlag.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()
  const accounting = useAccountingSetupState()

  const partDefId = useResourceProperty('part', 'id')
  const { canEditEntity } = useAccess()
  const canEdit = partDefId ? canEditEntity(partDefId) : false
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [filterParam] = useQueryState('filter')
  const [filter, setFilter] = useState<CostFilter>(() => parseCostFilter(filterParam))
  const [search, setSearch] = useState('')
  const [showMade, setShowMade] = useState(false)
  const [hideConfirmed, setHideConfirmed] = useState(false)
  const [groupBy, setGroupBy] = useState<CostGroupBy>('none')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(PAGE_SIZE)
  /** Typed costs not saved yet; `null` means cleared. */
  const [drafts, setDrafts] = useState<Record<string, number | null>>({})
  const [busy, setBusy] = useState(false)

  const bulkMode = useBulkMode()
  const selectedIds = useSelectionIds()
  const selectedCount = useSelectionCount()
  const setItemIds = useListSelection((s) => s.setItemIds)
  const clearSelection = useListSelection((s) => s.clear)
  const exitSelection = useListSelection((s) => s.exit)
  const toggleMany = useListSelection((s) => s.toggleMany)

  const allRows = useMemo(() => sortCostRows((worklist.data ?? []).map(toCostRow)), [worklist.data])
  const boughtRows = useMemo(() => allRows.filter((row) => !row.hasBom), [allRows])
  const products = useMemo(() => waitingProducts(worklist.data ?? []), [worklist.data])

  const query = search.trim().toLowerCase()
  const visibleRows = useMemo(
    () =>
      (showMade ? allRows : boughtRows).filter(
        (row) =>
          matchesCostFilter(row, filter) &&
          !(hideConfirmed && row.state === 'confirmed') &&
          (!query ||
            row.name.toLowerCase().includes(query) ||
            (row.sku ?? '').toLowerCase().includes(query))
      ),
    [showMade, allRows, boughtRows, filter, query, hideConfirmed]
  )
  const groups = useMemo(
    () => (groupBy === 'supplier' ? groupBySupplier(visibleRows) : null),
    [groupBy, visibleRows]
  )
  const paged = useMemo(() => visibleRows.slice(0, limit), [visibleRows, limit])
  // Grouped, every visible row is selectable (a group's box selects rows it may not show open).
  const selectableIds = useMemo(
    () => (groups ? visibleRows : paged).filter((row) => !row.hasBom).map((row) => row.partId),
    [groups, visibleRows, paged]
  )
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  useEffect(() => setItemIds(selectableIds), [selectableIds, setItemIds])

  const byId = useMemo(() => new Map(allRows.map((row) => [row.partId, row])), [allRows])
  const selectedRows = useMemo(
    () => selectedIds.flatMap((id) => byId.get(id) ?? []),
    [selectedIds, byId]
  )

  const refresh = useCallback(() => {
    void utils.builds.standardCostWorklist.invalidate()
    void utils.purchasing.listOpeningStockCandidates.invalidate()
    onChanged()
  }, [utils, onChanged])

  /** Writes a plan: first costs and changes through `setStandardCosts`, confirms on their own. */
  const writePlan = useCallback(
    async (plan: SourcePlan, source: CostSource | 'typed') => {
      const confirmAs =
        source === 'typed' || source === 'current' ? undefined : SOURCE_ORIGIN[source]
      const items = [
        ...plan.firstCosts.map(({ row, to }) => ({ partId: row.partId, unitCost: to, confirmAs })),
        ...plan.changes.map(({ row, to }) => ({ partId: row.partId, unitCost: to, confirmAs })),
      ]
      const failures: string[] = []
      for (const part of chunk(items, COST_CHUNK)) {
        for (const result of await setCosts.mutateAsync({ items: part })) {
          if (!result.ok) failures.push(`${byId.get(result.partId)?.name}: ${result.error}`)
        }
      }
      if (plan.confirms.length > 0) {
        await confirmCosts.mutateAsync({ partIds: plan.confirms.map((row) => row.partId) })
      }
      if (failures.length > 0) {
        toastError({
          title: `${failures.length} ${failures.length === 1 ? 'cost was' : 'costs were'} not saved`,
          description: failures.slice(0, 5).join('\n'),
        })
      }
    },
    [setCosts, confirmCosts, byId]
  )

  const describeChanges = (plan: SourcePlan): string | null => {
    if (plan.changes.length === 0) return null
    const listed = plan.changes
      .slice(0, 3)
      .map(
        ({ row, from, to }) =>
          `${row.name} ${formatCurrency(from, { currencyCode })} → ${formatCurrency(to, { currencyCode })}`
      )
      .join(', ')
    const more = plan.changes.length > 3 ? `, and ${plan.changes.length - 3} more` : ''
    const reval =
      plan.revaluationMinor !== 0
        ? ` Revalues the stock on hand by ${plan.revaluationMinor > 0 ? '+' : '−'}${formatCurrency(Math.abs(plan.revaluationMinor), { currencyCode })}${accounting.finalized ? ', posted to Inventory Revaluation' : ''}.`
        : ''
    return `Changes: ${listed}${more}.${reval}`
  }

  const run = async (plan: SourcePlan, source: CostSource | 'typed', title: string) => {
    const confirmed = await confirm({
      title,
      description: [
        `${sourcePlanLine(plan)}.`,
        describeChanges(plan),
        plan.skipped.length > 0 &&
          `${plan.skipped.length} selected ${plan.skipped.length === 1 ? 'part has' : 'parts have'} no cost from this source and ${plan.skipped.length === 1 ? 'is' : 'are'} skipped.`,
      ]
        .filter(Boolean)
        .join(' '),
      confirmText: 'Save',
      cancelText: 'Cancel',
    })
    if (!confirmed) return false
    setBusy(true)
    try {
      await writePlan(plan, source)
      return true
    } catch (error) {
      toastError({
        title: 'Error saving costs',
        description: error instanceof Error ? error.message : undefined,
      })
      return false
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const runSource = async (rows: CostRow[], source: CostSource) => {
    const plan = planSourceAction(rows, source)
    const count = plan.firstCosts.length + plan.confirms.length + plan.changes.length
    const saved = await run(
      plan,
      source,
      `${SOURCE_LABEL[source]} on ${count} ${count === 1 ? 'part' : 'parts'}?`
    )
    if (saved) clearSelection()
  }

  /** Typed costs, provisional with origin `manual` (73 §6.4): the first receipt still confirms. */
  const typedPlan = useMemo<SourcePlan>(() => {
    const plan: SourcePlan = {
      firstCosts: [],
      confirms: [],
      changes: [],
      unchanged: [],
      skipped: [],
      revaluationMinor: 0,
    }
    for (const [partId, to] of Object.entries(drafts)) {
      const row = byId.get(partId)
      if (!row || to == null || to === row.standardCost) continue
      if (row.standardCost == null) plan.firstCosts.push({ row, to })
      else {
        plan.changes.push({ row, from: row.standardCost, to })
        plan.revaluationMinor += Math.round((to - row.standardCost) * row.quantityOnHand)
      }
    }
    return plan
  }, [drafts, byId])
  const typedCount = typedPlan.firstCosts.length + typedPlan.changes.length

  const saveTyped = async () => {
    const saved = await run(
      typedPlan,
      'typed',
      `Save ${typedCount} ${typedCount === 1 ? 'cost' : 'costs'}?`
    )
    if (saved) setDrafts({})
  }

  const setSkipped = async (value: boolean) => {
    try {
      await setFlag.mutateAsync({ flag: 'costsSkipped', value })
      onChanged()
    } catch (error) {
      toastError({ title: 'Error saving the step', description: (error as Error).message })
    }
  }

  const setDraft = useCallback((partId: string, value: number | null) => {
    setDrafts((prev) => ({ ...prev, [partId]: value }))
  }, [])
  const acceptSuggestion = (row: CostRow) => {
    if (row.suggestion) void runSource([row], row.suggestion.source)
  }
  const confirmOne = (row: CostRow) => void runSource([row], 'current')

  const bulkActions: ActionBarAction[] = (['supplier', 'channel', 'current'] as const).map(
    (source) => {
      const count = sourceActionCount(selectedRows, source)
      return {
        id: `cost-${source}`,
        label: `${SOURCE_LABEL[source]} (${count})`,
        disabled: busy || count === 0,
        onClick: () => void runSource(selectedRows, source),
      }
    }
  )

  const renderRow = (row: CostRow) => (
    <CostRowLine
      key={row.partId}
      row={row}
      draft={drafts[row.partId]}
      currencyCode={currencyCode}
      canEdit={canEdit && !busy}
      partDefId={partDefId ?? null}
      onDraft={setDraft}
      onAccept={acceptSuggestion}
      onConfirm={confirmOne}
    />
  )

  const neededUncosted = status?.neededUncostedCount ?? 0
  const uncosted = boughtRows.filter((row) => row.state === 'none').length
  const skipped = neededUncosted > 0 && (status?.costsSkipped ?? false)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2 text-sm'>
        <span className='text-muted-foreground'>
          <span className='font-medium text-foreground'>
            {boughtRows.length.toLocaleString('en-US')} bought parts
          </span>{' '}
          · {uncosted.toLocaleString('en-US')} without a cost
          {neededUncosted > 0 && ` (${neededUncosted.toLocaleString('en-US')} needed for builds)`}
          {products.length > 0 &&
            ` · ${products.length.toLocaleString('en-US')} ${products.length === 1 ? 'product' : 'products'} waiting`}
        </span>
        <span className='text-muted-foreground text-xs'>
          Set costs before past builds, so each build is valued as it is written.
        </span>
      </div>

      <div className='shrink-0'>
        <ListToolbar sticky={false}>
          <SelectAllCheckbox listPadding={LIST_PADDING} disabled={!canEdit} />
          <ListToolbarGroup className='min-w-40 flex-1'>
            <InputSearch
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setLimit(PAGE_SIZE)
              }}
              placeholder='Search by part or SKU...'
              className='h-7'
            />
          </ListToolbarGroup>
          <ListToolbarGroup className='shrink-0'>
            <CostFilterPicker
              filter={filter}
              rows={showMade ? allRows : boughtRows}
              onChange={(next) => {
                setFilter(next)
                setLimit(PAGE_SIZE)
              }}
            />
            <CostGroupByPicker groupBy={groupBy} onChange={setGroupBy} />
            <label className='flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs'>
              <Switch size='sm' checked={hideConfirmed} onCheckedChange={setHideConfirmed} />
              Hide confirmed
            </label>
            <label className='flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs'>
              <Switch size='sm' checked={showMade} onCheckedChange={setShowMade} />
              Show made parts
            </label>
          </ListToolbarGroup>
        </ListToolbar>
      </div>

      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5' noFade>
        <div className='flex flex-col gap-3 p-3 pb-16'>
          {worklist.isLoading ? (
            <EmptySection loading />
          ) : visibleRows.length === 0 ? (
            <EmptySection
              icon={<Package className='size-5' />}
              title={boughtRows.length === 0 ? 'No bought parts' : 'No matches'}
            />
          ) : (
            <div className='rounded-lg border border-primary-200/50 dark:border-[#1e2227]'>
              <div
                className='sticky top-0 z-10 grid gap-x-2 rounded-t-lg border-primary-200/50 border-b bg-primary-50 px-1 py-2 text-muted-foreground text-sm dark:border-[#1e2227] dark:bg-background'
                style={{ gridTemplateColumns: COLS }}>
                <div className='pl-2'>Part</div>
                <Tooltip content='How many parts use this one in their parts list.'>
                  <div className='cursor-default px-2 text-right'>Used in</div>
                </Tooltip>
                <div className='px-2 text-right'>Suggested</div>
                <div className='px-2 text-right'>Cost</div>
                <div className='px-2'>State</div>
              </div>
              <div className='flex flex-col gap-0.5 py-1'>
                {groups
                  ? groups.map((group) => (
                      <div key={group.key} className='flex flex-col gap-0.5'>
                        <CostGroupHeader
                          group={group}
                          open={openGroups.has(group.key)}
                          selectedSet={selectedSet}
                          canSelect={canEdit}
                          onToggleOpen={toggleGroup}
                          onSelect={toggleMany}
                        />
                        {openGroups.has(group.key) && group.rows.map(renderRow)}
                      </div>
                    ))
                  : paged.map(renderRow)}
                {!groups && (
                  <InfiniteListTail
                    hasNextPage={visibleRows.length > limit}
                    isFetchingNextPage={false}
                    fetchNextPage={() => setLimit((current) => current + PAGE_SIZE)}
                    loadingLabel='Loading more parts...'
                  />
                )}
              </div>
            </div>
          )}

          {!showMade && products.length > 0 && <WaitingProducts products={products} />}
        </div>
      </ScrollArea>

      <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2'>
        {skipped ? (
          <span className='flex items-center gap-2 text-muted-foreground text-xs'>
            Skipped. Builds of parts without a cost are valued once a cost is set.
            <Button
              variant='ghost'
              size='xs'
              loading={setFlag.isPending}
              onClick={() => void setSkipped(false)}>
              Don't skip
            </Button>
          </span>
        ) : neededUncosted > 0 ? (
          <Button
            variant='ghost'
            size='sm'
            loading={setFlag.isPending}
            loadingText='Saving...'
            onClick={() => void setSkipped(true)}>
            Skip, build without costs
          </Button>
        ) : (
          <span />
        )}
        <Button
          variant='outline'
          size='sm'
          disabled={!canEdit || typedCount === 0}
          loading={busy}
          loadingText='Saving...'
          onClick={() => void saveTyped()}>
          Save {typedCount} {typedCount === 1 ? 'cost' : 'costs'}
        </Button>
      </div>

      <ActionBar
        open={canEdit && (bulkMode || selectedCount > 0)}
        onOpenChange={(open) => {
          if (!open) exitSelection()
        }}
        selectedCount={selectedCount}
        selectedLabel='selected'
        actions={bulkActions}
        showClose
      />
      <ConfirmDialog />
    </div>
  )
}

function CostGroupByPicker({
  groupBy,
  onChange,
}: {
  groupBy: CostGroupBy
  onChange: (groupBy: CostGroupBy) => void
}) {
  const [open, setOpen] = useState(false)
  const active = COST_GROUP_BYS.find((option) => option.value === groupBy)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='justify-start'>
          <Group />
          <span className='text-left'>
            {groupBy === 'none' || !active ? 'Group' : `Group: ${active.label}`}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-52 p-0'>
        <Command>
          <CommandList>
            <CommandGroup heading='Group by'>
              {COST_GROUP_BYS.map((option) => (
                <CommandDetailItem
                  key={option.value}
                  value={option.label}
                  title={option.label}
                  selected={option.value === groupBy}
                  selectionMode='check'
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** A supplier group: its box selects every visible part inside it, open or not. */
function CostGroupHeader({
  group,
  open,
  selectedSet,
  canSelect,
  onToggleOpen,
  onSelect,
}: {
  group: CostGroup
  open: boolean
  selectedSet: ReadonlySet<string>
  canSelect: boolean
  onToggleOpen: (key: string) => void
  onSelect: (ids: string[], on: boolean) => void
}) {
  const ids = group.rows.filter((row) => !row.hasBom).map((row) => row.partId)
  const picked = ids.filter((id) => selectedSet.has(id)).length
  const checked = picked === 0 ? false : picked === ids.length ? true : 'indeterminate'
  return (
    <div className='flex items-center gap-2 rounded-md bg-primary-100 px-2 py-1.5 text-sm'>
      <Checkbox
        checked={checked}
        disabled={!canSelect || ids.length === 0}
        aria-label={`Select every part from ${group.label}`}
        onCheckedChange={() => onSelect(ids, checked !== true)}
      />
      <button
        type='button'
        onClick={() => onToggleOpen(group.key)}
        className='flex min-w-0 flex-1 items-center gap-1.5 text-left'>
        {open ? (
          <ChevronDown className='size-4 shrink-0 text-muted-foreground' />
        ) : (
          <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
        )}
        <span className='truncate font-medium'>{group.label}</span>
        <span className='shrink-0 text-muted-foreground text-xs'>
          {group.rows.length} {group.rows.length === 1 ? 'part' : 'parts'}
          {group.withoutCost > 0 && ` · ${group.withoutCost} without a cost`}
        </span>
      </button>
    </div>
  )
}

function CostFilterPicker({
  filter,
  rows,
  onChange,
}: {
  filter: CostFilter
  rows: CostRow[]
  onChange: (filter: CostFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const counts = useMemo(
    () =>
      new Map(
        COST_FILTERS.map((option) => [
          option.value,
          rows.filter((row) => matchesCostFilter(row, option.value)).length,
        ])
      ),
    [rows]
  )
  const active = COST_FILTERS.find((option) => option.value === filter)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='justify-start'>
          <ListFilter />
          <span className='text-left tabular-nums'>
            {filter === 'all' || !active ? 'Filter' : `${active.label} (${counts.get(filter)})`}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 p-0'>
        <Command>
          <CommandInput placeholder='Search filters…' />
          <CommandList>
            <CommandGroup heading='Cost'>
              {COST_FILTERS.map((option) => (
                <CommandDetailItem
                  key={option.value}
                  value={option.label}
                  title={option.label}
                  secondary={
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {counts.get(option.value)}
                    </span>
                  }
                  selected={option.value === filter}
                  selectionMode='check'
                  onSelect={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CostRowLine({
  row,
  draft,
  currencyCode,
  canEdit,
  partDefId,
  onDraft,
  onAccept,
  onConfirm,
}: {
  row: CostRow
  /** `undefined`: not typed; `null`: cleared. */
  draft: number | null | undefined
  currencyCode: string
  canEdit: boolean
  partDefId: string | null
  onDraft: (partId: string, value: number | null) => void
  onAccept: (row: CostRow) => void
  onConfirm: (row: CostRow) => void
}) {
  const bulkMode = useBulkMode()
  const selected = useIsSelected(row.partId)
  const toggle = useListSelection((s) => s.toggle)
  const selectable = canEdit && !row.hasBom
  const selecting = bulkMode && selectable
  const money = (value: number) => formatCurrency(value, { currencyCode })
  const recordId: RecordId | null = partDefId ? toRecordId(partDefId, row.partId) : null
  const typed = draft !== undefined && draft !== row.standardCost

  return (
    <GridTreeRow
      columns={COLS}
      rowClassName='gap-x-2 rounded-md bg-primary-100/50 hover:bg-primary-100'
      onToggleOpen={selecting ? () => toggle(row.partId) : undefined}
      icon={
        selectable ? (
          <span className='relative flex size-5 items-center justify-center'>
            <Package
              className={cn(
                'size-4 text-muted-foreground transition-opacity',
                selecting ? 'opacity-0' : 'group-hover/tree-row:opacity-0'
              )}
            />
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity',
                !selecting &&
                  'opacity-0 group-hover/tree-row:opacity-100 has-[:focus-visible]:opacity-100'
              )}>
              <Checkbox
                checked={selected}
                aria-label={row.name}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(row.partId, { shiftKey: e.shiftKey })
                }}
              />
            </span>
          </span>
        ) : (
          <Package className='size-4 text-muted-foreground' />
        )
      }
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          {recordId ? (
            <RecordBadge recordId={recordId} variant='link' showIcon={false} className='min-w-0' />
          ) : (
            <span className='min-w-0 truncate'>{row.name}</span>
          )}
          {!row.needed && (
            <span className='shrink-0 text-muted-foreground text-xs'>not used yet</span>
          )}
        </span>
      }
      cells={[
        <span
          key='used'
          className='w-full pr-1 text-right text-muted-foreground text-xs tabular-nums'>
          {row.usedIn > 0 ? row.usedIn.toLocaleString('en-US') : '—'}
        </span>,

        <SuggestedCell
          key='suggested'
          row={row}
          money={money}
          canAccept={canEdit && row.state !== 'confirmed'}
          onAccept={onAccept}
        />,

        row.hasBom ? (
          <span
            key='cost'
            className='w-full pr-1 text-right text-muted-foreground text-xs leading-tight'>
            {row.standardCost != null ? money(row.standardCost) : 'Rolls from its parts'}
            {row.uncostedLeafIds.length > 0 && (
              <span className='block text-[11px]'>{row.uncostedLeafIds.length} without a cost</span>
            )}
          </span>
        ) : (
          <div key='cost' className='flex w-full flex-col items-end leading-tight'>
            <EditableCell className='w-full'>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
                value={draft !== undefined ? draft : row.standardCost}
                onChange={(value) => onDraft(row.partId, (value as number) ?? null)}
                placeholder='later'
                disabled={!canEdit}
              />
            </EditableCell>
            {typed && <span className='pr-1 text-[11px] text-muted-foreground'>not saved</span>}
          </div>
        ),

        <span key='state' className='flex min-w-0 items-center gap-1 px-1'>
          {row.state === 'none' ? (
            <Badge variant='outline' size='xs' className='shrink-0'>
              No cost
            </Badge>
          ) : (
            <Badge
              variant={row.state === 'confirmed' ? 'green' : 'amber'}
              size='xs'
              className='shrink-0'>
              {row.state === 'confirmed' ? 'Confirmed' : 'Provisional'}
            </Badge>
          )}
          {row.origin && row.state !== 'none' && (
            <span className='truncate text-[11px] text-muted-foreground'>
              {ORIGIN_LABEL[row.origin] ?? row.origin}
            </span>
          )}
          {row.state === 'provisional' && canEdit && !row.hasBom && (
            <Button
              variant='ghost'
              size='xs'
              className='ml-auto shrink-0'
              onClick={() => onConfirm(row)}>
              Confirm
            </Button>
          )}
        </span>,
      ]}
    />
  )
}

function SuggestedCell({
  row,
  money,
  canAccept,
  onAccept,
}: {
  row: CostRow
  money: (value: number) => string
  canAccept: boolean
  onAccept: (row: CostRow) => void
}) {
  const { suggestion } = row
  if (!suggestion) {
    return <span className='w-full pr-1 text-right text-muted-foreground text-xs'>—</span>
  }
  const matches = suggestion.unitCost === row.standardCost && row.state === 'confirmed'
  return (
    <div className='flex w-full items-center justify-end gap-1 leading-tight'>
      <span className='flex flex-col items-end text-xs tabular-nums'>
        <span>
          {money(suggestion.unitCost)}{' '}
          <span className='text-muted-foreground'>
            {suggestion.source === 'supplier' ? 'supplier' : 'channel'}
          </span>
        </span>
        {suggestion.other && (
          <span className='text-[11px] text-muted-foreground'>
            {suggestion.other.source === 'supplier' ? 'Supplier' : 'Channel'}:{' '}
            {money(suggestion.other.unitCost)}
          </span>
        )}
      </span>
      {canAccept && !matches && (
        <Tooltip content='Use this cost and mark it confirmed'>
          <Button
            variant='transparent'
            aria-label='Use suggested cost'
            className='h-5.5 w-5.5 shrink-0 rounded-[6px] px-1 text-green-600 dark:text-green-500! bg-green-400/40 hover:bg-green-400/60 dark:bg-green-900!'
            onClick={() => onAccept(row)}>
            <Check />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

function WaitingProducts({
  products,
}: {
  products: { partId: string; name: string; waitingOn: string[] }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className='rounded-lg border'>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm'>
        {open ? (
          <ChevronDown className='size-4 text-muted-foreground' />
        ) : (
          <ChevronRight className='size-4 text-muted-foreground' />
        )}
        <span className='font-medium'>Products waiting ({products.length})</span>
        <span className='text-muted-foreground text-xs'>
          Their cost rolls up once every part below has one.
        </span>
      </button>
      {open && (
        <ul className='flex flex-col gap-1 border-t px-3 py-2 text-sm'>
          {products.map((product) => (
            <li key={product.partId} className='flex flex-wrap gap-x-2'>
              <span className='font-medium'>{product.name}</span>
              <span className='text-muted-foreground'>
                waiting on {product.waitingOn.slice(0, 4).join(', ')}
                {product.waitingOn.length > 4 && ` and ${product.waitingOn.length - 4} more`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
