// apps/web/src/components/accounting/ui/banking/review/review-toolbar.tsx

'use client'

import {
  REVIEW_STATUS_LABELS,
  type ReviewQueueState,
} from '@auxx/lib/accounting/banking/review/client'
import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { Input } from '@auxx/ui/components/input'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { format } from 'date-fns'
import { Ban, CircleX, Inbox, Link2, List, type LucideIcon, Sparkles, Tag } from 'lucide-react'
import { BankAccountPicker } from '~/components/accounting/ui/bank-account-picker'
import { Tooltip } from '~/components/global/tooltip'

/** Every filter the queue narrows on. All of them run in SQL. */
export interface ReviewFilters {
  bankAccountId: string | null
  state: ReviewQueueState
  search: string
  from: string
  to: string
  /** Dollars as typed, converted to minor units by the page. Blank means unset. */
  amountMin: string
  amountMax: string
}

export const EMPTY_REVIEW_FILTERS: ReviewFilters = {
  bankAccountId: null,
  state: 'for_review',
  search: '',
  from: '',
  to: '',
  amountMin: '',
  amountMax: '',
}

/**
 * The five statuses plus "everything", in the order a reviewer works through
 * them. The icons pair with the drawer's treatment tabs on purpose - `Link2`
 * is "matched to a document" and `Tag` is "coded to an account" in both
 * places, so the pile you filtered to and the decision that fills it read as
 * the same word.
 */
const STATES: { value: ReviewQueueState; label: string; icon: LucideIcon }[] = [
  { value: 'for_review', label: REVIEW_STATUS_LABELS.for_review, icon: Inbox },
  { value: 'suggested', label: REVIEW_STATUS_LABELS.suggested, icon: Sparkles },
  { value: 'matched', label: REVIEW_STATUS_LABELS.matched, icon: Link2 },
  { value: 'coded', label: REVIEW_STATUS_LABELS.coded, icon: Tag },
  { value: 'excluded', label: REVIEW_STATUS_LABELS.excluded, icon: Ban },
  { value: 'all', label: 'All', icon: List },
]

interface ReviewToolbarProps {
  filters: ReviewFilters
  onChange: (next: ReviewFilters) => void
  /**
   * The list's select-all box, FIRST in row two beside the search.
   *
   * 🛑 First, or the alignment is wrong: the box's `marginLeft` is measured from
   * `ListToolbar`'s own `px-3`, so it lands on the rows' checkboxes only when
   * nothing precedes it in the bar. A node for the same reason `actions` was:
   * the selection store it reads belongs to the page.
   */
  selectAll?: React.ReactNode
}

/**
 * A calendar day as the filter holds it: `YYYY-MM-DD` in the VIEWER's zone.
 *
 * ⚠️ Not `toISOString().slice(0, 10)`. The picker's presets are built from
 * `startOfDay`/`endOfDay` in local time, so west of UTC the ISO string is
 * already the next day and every preset landed a day late.
 */
const asDay = (date: Date) => format(date, 'yyyy-MM-dd')

/** `YYYY-MM-DD` back to local midnight, the same round trip in reverse. */
const asDate = (day: string) => new Date(`${day}T00:00:00`)

/**
 * The queue's toolbar: account, state, search, date range, amount range
 * (plans/accounting/ui-plan.md §2.8).
 *
 * TWO `ListToolbar` rows inside one sticky block, not one row: the six-item
 * state `RadioTab` plus an account combobox plus search plus a date range plus two
 * amounts cannot share a line at any width a person actually uses, and
 * `ListToolbar`'s `overflow-x-auto` turns that into a horizontal scroll that
 * hides half the filters. Row one is what you are looking AT (account, then
 * which pile of it); row two is how you narrow it. The state `RadioTab` is
 * second on its row because the ACCOUNT is what a bookkeeper reconciles against
 * a statement.
 *
 * 🛑 The state `RadioTab` stays here and not in the module topbar: it is what
 * defines `SelectAllCheckbox`'s `BOX_PX = 48`, so lifting it re-heights the bar
 * and every checkbox offset below is wrong (task 81 §3).
 *
 * Both rows are `sticky={false}` because the wrapper is the sticky element -
 * two sticky rows would pin to the same `top-0` and cover each other.
 *
 * ⚠️ The amount inputs take DOLLARS, which the page converts once. Every figure
 * that crosses the wire is integer minor units; this is the one boundary where
 * a person's `12.50` becomes `1250`, and it is deliberately not two conventions.
 */
export function ReviewToolbar({ filters, onChange, selectAll }: ReviewToolbarProps) {
  const set = <K extends keyof ReviewFilters>(key: K, value: ReviewFilters[K]) =>
    onChange({ ...filters, [key]: value })

  // Both ends or neither: `DateRangePicker` only ever hands back a complete
  // range, and a half-open one would render as a selection the picker cannot
  // reproduce.
  const range =
    filters.from && filters.to ? { from: asDate(filters.from), to: asDate(filters.to) } : undefined

  const dirty =
    !!filters.search || !!filters.from || !!filters.to || !!filters.amountMin || !!filters.amountMax

  // 🛑 Always rendered, disabled when there is nothing to clear. Gating it on
  // `dirty` re-flowed the row on the first keystroke in the search beside it.
  const clear = (
    <Tooltip content='Clear all'>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label='Clear all'
        disabled={!dirty}
        onClick={() =>
          onChange({
            ...EMPTY_REVIEW_FILTERS,
            bankAccountId: filters.bankAccountId,
            state: filters.state,
          })
        }>
        <CircleX />
      </Button>
    </Tooltip>
  )

  return (
    <div className='sticky top-0 z-10 shrink-0 backdrop-blur-sm'>
      <ListToolbar sticky={false}>
        <ListToolbarGroup className='shrink-0'>
          {/* The shared picker, so this filter groups by institution like every
              other bank-account list in the app. `allLabel` is what a filter
              needs and a form field does not: "no account" is a real choice
              here, not an empty value. */}
          <BankAccountPicker
            value={filters.bankAccountId}
            onChange={(id) => set('bankAccountId', id)}
            allLabel='All accounts'
            triggerProps={{ variant: 'ghost', size: 'sm', className: 'w-auto ps-2 pe-1' }}
          />
        </ListToolbarGroup>

        <Separator orientation='vertical' className='h-5 shrink-0' />

        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={filters.state}
            onValueChange={(value) => set('state', value as ReviewQueueState)}
            size='sm'>
            {STATES.map((state) => (
              <RadioTabItem key={state.value} value={state.value}>
                <state.icon />
                {state.label}
              </RadioTabItem>
            ))}
          </RadioTab>
        </ListToolbarGroup>
      </ListToolbar>

      <ListToolbar sticky={false}>
        {selectAll}

        <ListToolbarGroup className='min-w-40 flex-1'>
          <InputSearch
            value={filters.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder='Search description'
            className='h-7'
          />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>
          {/* ONE control, not two boxes. A bookkeeper working a backlog reaches
              for "last 30 days" or "this quarter" far more often than for a
              specific pair of days, and two date fields cannot offer either -
              the presets are the point, the custom range is the fallback. */}
          <DateRangePicker
            value={range}
            onChange={(next: DateRange) =>
              onChange({ ...filters, from: asDay(next.from), to: asDay(next.to) })
            }
            showShortLabel
            placeholder='Any date'
            triggerVariant='ghost'
            triggerClassName='h-7 w-48 text-xs'
          />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>
          <Input
            inputMode='decimal'
            aria-label='Minimum amount'
            placeholder='Min'
            value={filters.amountMin}
            onChange={(event) => set('amountMin', event.target.value)}
            className='h-7 w-24 font-mono tabular-nums'
          />
          <Input
            inputMode='decimal'
            aria-label='Maximum amount'
            placeholder='Max'
            value={filters.amountMax}
            onChange={(event) => set('amountMax', event.target.value)}
            className='h-7 w-24 font-mono tabular-nums'
          />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>{clear}</ListToolbarGroup>
      </ListToolbar>
    </div>
  )
}
