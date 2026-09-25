// apps/web/src/components/mrp/ui/plan/plan-toolbar.tsx

'use client'

import {
  MRP_SUGGESTION_KIND_LABELS,
  MRP_SUGGESTION_KINDS,
  MRP_SUPPLY_TYPE_LABELS,
  MRP_SUPPLY_TYPES,
} from '@auxx/lib/mrp/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Building2,
  ChevronDown,
  CircleX,
  Layers,
  Rows3,
  Shield,
  Tags,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { SelectAllCheckbox } from '~/components/list-selection'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import type { RouterOutputs } from '~/trpc/react'
import { MRP_GROUP_BYS, type MrpFilters, type MrpGroupBy } from '../../hooks/use-mrp-filters'
import { MRP_LIST_PADDING } from './plan-tabs'

type SummaryCounts = NonNullable<RouterOutputs['mrp']['summary']['counts']>
type SupplierFacet = NonNullable<RouterOutputs['mrp']['summary']['facets']>['bySupplier'][number]

export interface PlanToolbarProps {
  filters: MrpFilters
  onChange: (patch: Partial<MrpFilters>) => void
  onClear: () => void
  isDirty: boolean
  /** Facet counts for the option labels; null before the summary loads. */
  counts: SummaryCounts | null | undefined
  /** The run's suppliers off `mrp.summary`'s facet; empty before it loads. */
  supplierFacet: SupplierFacet[] | null | undefined
  selectionDisabled?: boolean
}

const GROUP_LABEL: Record<MrpGroupBy, string> = {
  none: 'No groups',
  supplier: 'By supplier',
  finished_good: 'By product',
}

const withCount = (label: string, count: number | undefined) =>
  count === undefined ? label : `${label} (${count})`

/** The action list's narrowing controls beneath its status tabs (07 §4.1). */
export function PlanToolbar({
  filters,
  onChange,
  onClear,
  isDirty,
  counts,
  supplierFacet,
  selectionDisabled = false,
}: PlanToolbarProps) {
  const supplierOptions = (supplierFacet ?? []).map((s) => ({
    value: s.supplierId,
    label: withCount(s.name ?? 'Unnamed supplier', s.count),
  }))
  const kindOptions = MRP_SUGGESTION_KINDS.map((kind) => ({
    value: kind,
    label: withCount(MRP_SUGGESTION_KIND_LABELS[kind], counts?.bySuggestionKind[kind]),
  }))
  const supplyOptions = MRP_SUPPLY_TYPES.map((type) => ({
    value: type,
    label: withCount(MRP_SUPPLY_TYPE_LABELS[type], counts?.bySupplyType[type]),
  }))
  const bufferedOptions = [
    { value: 'true', label: withCount('Buffered', counts?.buffered) },
    { value: 'false', label: withCount('Not buffered', counts?.unbuffered) },
  ]

  return (
    <ListToolbar sticky={false}>
      <SelectAllCheckbox listPadding={MRP_LIST_PADDING} disabled={selectionDisabled} />
      <ListToolbarGroup className='min-w-40 flex-1'>
        <InputSearch
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          maxLength={200}
          placeholder='Search parts'
          className='h-7'
        />
      </ListToolbarGroup>
      <ListToolbarGroup className='shrink-0'>
        <FilterPicker
          label='Kind'
          icon={Tags}
          options={kindOptions}
          value={filters.suggestionKind}
          onChange={(value) =>
            onChange({ suggestionKind: MRP_SUGGESTION_KINDS.filter((k) => value.includes(k)) })
          }
        />
        <FilterPicker
          label='Supplier'
          icon={Building2}
          options={supplierOptions}
          value={filters.supplierIds}
          onChange={(value) => onChange({ supplierIds: [...value].sort() })}
        />
        <FilterPicker
          label='Buffered'
          icon={Shield}
          options={bufferedOptions}
          value={filters.buffered === null ? [] : [String(filters.buffered)]}
          // Both or neither reads as either.
          onChange={(value) =>
            onChange({ buffered: value.length === 1 ? value[0] === 'true' : null })
          }
        />
        <FilterPicker
          label='Supply'
          icon={Layers}
          options={supplyOptions}
          value={filters.supplyType}
          onChange={(value) =>
            onChange({ supplyType: MRP_SUPPLY_TYPES.filter((t) => value.includes(t)) })
          }
        />
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Clear filters'
          disabled={!isDirty}
          onClick={onClear}>
          <CircleX />
        </Button>
      </ListToolbarGroup>
      {/* View choices, not filters: they survive Clear. */}
      <ListToolbarGroup align='end' className='shrink-0'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              className='w-32 justify-start'
              aria-label={GROUP_LABEL[filters.groupBy]}>
              <Rows3 />
              <span className='flex-1 text-left'>{GROUP_LABEL[filters.groupBy]}</span>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuRadioGroup
              value={filters.groupBy}
              onValueChange={(value) =>
                onChange({
                  groupBy: MRP_GROUP_BYS.find((g) => g === value) ?? 'none',
                })
              }>
              {MRP_GROUP_BYS.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {GROUP_LABEL[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={
            filters.direction === 'asc'
              ? 'Most urgent first, switch to least urgent first'
              : 'Least urgent first, switch to most urgent first'
          }
          onClick={() => onChange({ direction: filters.direction === 'asc' ? 'desc' : 'asc' })}>
          {filters.direction === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
        </Button>
      </ListToolbarGroup>
    </ListToolbar>
  )
}

/** A ghost trigger over a `MultiSelectPicker`, the outbox's category control. */
function FilterPicker({
  label,
  icon: Icon,
  options,
  value,
  onChange,
}: {
  label: string
  icon: ComponentType
  options: Array<{ value: string; label: string }>
  value: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='justify-start'
          aria-label={value.length ? `${label}, ${value.length} selected` : `${label}, any`}>
          <Icon />
          <span className='text-left tabular-nums'>
            {label}
            {value.length > 0 ? ` (${value.length})` : ''}
          </span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 p-0'>
        <MultiSelectPicker
          options={options}
          value={value}
          multi
          canAdd={false}
          canManage={false}
          placeholder={`Search ${label.toLowerCase()}…`}
          onChange={onChange}
        />
        <Button
          variant='ghost'
          size='sm'
          className='w-full'
          disabled={!value.length}
          onClick={() => onChange([])}>
          Any {label.toLowerCase()}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
