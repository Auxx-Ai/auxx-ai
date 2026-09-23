// apps/web/src/components/accounting/ui/banking/payouts/payouts-toolbar.tsx

'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { type DateRange, DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { format } from 'date-fns'
import {
  Ban,
  CircleAlert,
  CircleX,
  Link2Off,
  List,
  type LucideIcon,
  RefreshCw,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { sourceAccountLabel } from '~/components/accounting/ui/source-account-label'
import { SourceProviderIcon } from '~/components/accounting/ui/source-provider-icon'
import { Tooltip } from '~/components/global/tooltip'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/**
 * Every filter the payouts list narrows on. All of them run in SQL.
 *
 * 🛑 No amount range, unlike `ReviewToolbar`. The queue is pinned to one display
 * currency, so a single min/max is a well-defined question there. A payout row
 * carries its own `sourceCurrency`/`sourceCurrencyExponent` exactly as the
 * provider reported it, so one pair of boxes would silently compare 100 JPY with
 * 100 USD - a filter that looks precise and is wrong.
 */
export interface PayoutFilters {
  sourceAccountId: string | null
  /** `'all'` or a `MoneyTransfer.status` value. */
  status: string
  search: string
  from: string
  to: string
  /** The accountant's worklist: payouts holding an open item (§10.4). One SQL `EXISTS`. */
  needsMatching: boolean
}

export const EMPTY_PAYOUT_FILTERS: PayoutFilters = {
  sourceAccountId: null,
  status: 'all',
  search: '',
  from: '',
  to: '',
  needsMatching: false,
}

/**
 * The status vocabulary this toolbar offers, `all` first.
 *
 * 🛑 Only the three ways a payout did NOT land (81 §5.5). The row already ends
 * with a coloured dot and the status word, so the filter only has to answer
 * *find me the ones I cannot see from here*: `in_transit` self-resolves within
 * a day and `paid` is approximately `all`. `STATUS_DOT` in `payouts-page.tsx`
 * keeps all five keys — the tabs shrink, the row's vocabulary does not.
 *
 * 🛑 Not one `Exceptions` tab. `MoneyTransfer.status` is free text carrying the
 * provider's word and the set is explicitly open, so a server-side exception
 * SET would silently hide a payout whose status is none of the five.
 *
 * Exported so the page can validate `?status=` before it reaches the query: the
 * tabs below can only emit these, but a hand-edited URL can emit anything, and
 * an old `?status=paid` link folds back to `all` rather than 400ing.
 */
export const PAYOUT_FILTER_STATUSES = ['all', 'failed', 'canceled', 'reversed'] as const

export type PayoutFilterStatus = (typeof PAYOUT_FILTER_STATUSES)[number]

/**
 * Sentence case, because these are the provider's snake_case tokens rendered as
 * words - the same treatment the row's status text gets.
 */
const STATUSES: { value: PayoutFilterStatus; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'All', icon: List },
  { value: 'failed', label: 'Failed', icon: CircleAlert },
  { value: 'canceled', label: 'Canceled', icon: Ban },
  { value: 'reversed', label: 'Reversed', icon: Undo2 },
]

/**
 * A calendar day as the filter holds it: `YYYY-MM-DD` in the VIEWER's zone.
 *
 * ⚠️ Not `toISOString().slice(0, 10)`, for the reason `review-toolbar.tsx`
 * documents: the picker's presets are built from local `startOfDay`/`endOfDay`,
 * so west of UTC the ISO string is already the next day and every preset lands
 * a day late.
 */
const asDay = (date: Date) => format(date, 'yyyy-MM-dd')

/** `YYYY-MM-DD` back to local midnight, the same round trip in reverse. */
const asDate = (day: string) => new Date(`${day}T00:00:00`)

/** The "no filter" row's option value. Never a real account id. */
const ALL_SOURCE_ACCOUNTS = '__all_source_accounts__'

interface SourceAccountPickerProps {
  value: string | null
  onChange: (id: string | null) => void
}

/**
 * A single-select over the source accounts that actually have payouts.
 *
 * 🛑 NOT `BankAccountPicker`, which resolves `bank_account` rows - a different
 * table, a different identity, and two creation doors ("Connect a bank", "Add
 * manually") that cannot produce a `FinancialSourceAccount`. An account here
 * exists because a connector wrote it, so this picker has no floor actions at
 * all: there is nothing a reader could add from inside it.
 *
 * Built from the same primitives `BankAccountPicker` composes - `Popover` +
 * `PickerTrigger` + `MultiSelectPicker` - so the closed trigger and the open
 * list are the app's combobox rather than a second shape.
 *
 * Flat, with no grouping: the provider is already carried by the brand mark on
 * the trigger, and an org has a handful of source accounts rather than the
 * dozens per institution a bank list can reach.
 *
 * The list comes from `payoutEvidence.sourceAccounts`, which returns the
 * accounts that appear on a payout, so the filter can never offer a choice that
 * empties the list.
 */
function SourceAccountPicker({ value, onChange }: SourceAccountPickerProps) {
  const query = api.payoutEvidence.sourceAccounts.useQuery()
  const [open, setOpen] = useState(false)

  const accounts = useMemo(() => query.data ?? [], [query.data])

  const options = useMemo<SelectOption[]>(
    () => [
      { value: ALL_SOURCE_ACCOUNTS, label: 'All source accounts' },
      ...accounts.map((account) => ({ value: account.id, label: sourceAccountLabel(account) })),
    ],
    [accounts]
  )

  const selected = useMemo(
    () => accounts.find((account) => account.id === value) ?? null,
    [accounts, value]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={query.isPending}
          variant='ghost'
          size='sm'
          hasValue={!!selected}
          placeholder='All source accounts'
          /* A filter clears by picking its own "All source accounts" row, so an
             x on the trigger would be a second control for one decision - the
             rule `BankAccountPicker` applies whenever `allLabel` is set. */
          showClear={false}
          asCombobox
          className='h-auto min-h-8 w-auto ps-2 pe-1'>
          {selected && (
            <span className='flex min-w-0 items-center gap-1.5'>
              <SourceProviderIcon providerKey={selected.providerKey} />
              <span className='truncate text-sm'>{sourceAccountLabel(selected)}</span>
            </span>
          )}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),18rem)] p-0'
        align='start'>
        <MultiSelectPicker
          options={options}
          value={value ? [value] : [ALL_SOURCE_ACCOUNTS]}
          multi={false}
          canAdd={false}
          canManage={false}
          isLoading={query.isPending}
          placeholder='Search source accounts…'
          /* The environment is part of a source account's identity, so a test
             account has to be tellable from the live one it shadows. Only the
             non-live case is marked: `live` is the answer on nearly every row
             and a badge on all of them would say nothing. */
          renderItemAction={(opt) => {
            const account = accounts.find((row) => row.id === opt.value)
            if (!account || !account.environment || account.environment === 'live') return null
            return (
              <Badge variant='outline' size='xs'>
                {account.environment}
              </Badge>
            )
          }}
          onChange={(next) => {
            const picked = next[0] ?? null
            onChange(picked === ALL_SOURCE_ACCOUNTS ? null : picked)
          }}
          onSelectSingle={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Re-run the matcher over the org's open items now, rather than waiting for the nightly pass. */
function RecheckMatchesButton() {
  const canPost = useAccess().can('ledger.post')
  const utils = api.useUtils()
  const recheckMatches = api.payoutEvidence.recheckMatches.useMutation({
    onSuccess: () => void utils.payoutEvidence.invalidate(),
    onError: (error) =>
      toastError({ title: 'Error re-checking matches', description: error.message }),
  })
  if (!canPost) return null
  return (
    <Button
      variant='ghost'
      size='sm'
      className='h-7'
      loading={recheckMatches.isPending}
      loadingText='Re-checking...'
      onClick={() => recheckMatches.mutate()}>
      <RefreshCw />
      Re-check matches
    </Button>
  )
}

interface PayoutsToolbarProps {
  filters: PayoutFilters
  onChange: (next: PayoutFilters) => void
  /**
   * The list's `SelectAllCheckbox`, FIRST in row two beside the search.
   *
   * 🛑 First, or the alignment is wrong. The box's `marginLeft` is measured from
   * `ListToolbar`'s own `px-3`, so it only lands on the `TreeRow` checkboxes
   * below when nothing precedes it in the bar. Its `size-12 -my-2` is also what
   * holds the row at 48px without a `RadioTab` in it.
   */
  selectAll?: ReactNode
}

/**
 * The payouts list's toolbar: source account, status, search, date range.
 *
 * TWO `ListToolbar` rows in one block, the shape `review-toolbar.tsx` settled
 * on and for the same reason: a `RadioTab` plus an account combobox plus search
 * plus a date range cannot share a line at a width anybody
 * actually uses, and `ListToolbar`'s `overflow-x-auto` turns that into a
 * horizontal scroll that hides half the filters. Row one is what you are looking
 * AT - which account, then which pile of it; row two is how you narrow that
 * down. The account leads because it is the statement a reader reconciles
 * against.
 *
 * 🛑 No bulk bar and no selection, unlike the queue. `payoutEvidence` exposes
 * zero mutations - this screen shows what the provider reported and nothing on
 * it can be acted on - so checkboxes would select rows for an action that does
 * not exist.
 *
 * Both rows are `sticky={false}`: the block sits ABOVE the list's `ScrollArea`
 * rather than inside it, so it never scrolls and has nothing to pin against.
 */
export function PayoutsToolbar({ filters, onChange, selectAll }: PayoutsToolbarProps) {
  const set = <K extends keyof PayoutFilters>(key: K, value: PayoutFilters[K]) =>
    onChange({ ...filters, [key]: value })

  // Both ends or neither: `DateRangePicker` only ever hands back a complete
  // range, and a half-open one would render as a selection the picker cannot
  // reproduce.
  const range =
    filters.from && filters.to ? { from: asDate(filters.from), to: asDate(filters.to) } : undefined

  // 🛑 Only row two counts as dirty. The account and the status are the VIEW -
  // they live in the URL and a Clear that reset them would drop the link
  // somebody arrived on, which is the opposite of what the button is for.
  const dirty = !!filters.search || !!filters.from || !!filters.to || filters.needsMatching

  return (
    <div className='shrink-0'>
      <ListToolbar sticky={false}>
        <ListToolbarGroup className='shrink-0'>
          <SourceAccountPicker
            value={filters.sourceAccountId}
            onChange={(id) => set('sourceAccountId', id)}
          />
        </ListToolbarGroup>

        <Separator orientation='vertical' className='h-5 shrink-0' />

        <ListToolbarGroup className='shrink-0'>
          <RadioTab
            value={filters.status}
            onValueChange={(value) => set('status', value)}
            size='sm'>
            {STATUSES.map((status) => (
              <RadioTabItem key={status.value} value={status.value}>
                <status.icon />
                {status.label}
              </RadioTabItem>
            ))}
          </RadioTab>
        </ListToolbarGroup>
      </ListToolbar>

      <ListToolbar sticky={false}>
        {selectAll}

        <ListToolbarGroup className='min-w-40 flex-1'>
          {/* The payout id, not a description: these rows have no free text on
              them at all. What a reader has in hand is a `po_…` or a `gid://…`
              copied out of a provider dashboard or a bank line. */}
          <InputSearch
            value={filters.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder='Search payout id'
            className='h-7'
          />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>
          {/* A toggle, not a fourth status tab: it crosses the status axis - an
              already-paid payout is exactly the one whose items still need
              matching. */}
          <Button
            variant={filters.needsMatching ? 'secondary' : 'ghost'}
            size='sm'
            className='h-7'
            aria-pressed={filters.needsMatching}
            onClick={() => set('needsMatching', !filters.needsMatching)}>
            <Link2Off />
            Needs matching
          </Button>
          <RecheckMatchesButton />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>
          {/* ONE control, not two boxes. Somebody checking a deposit reaches for
              "last 30 days" or "this quarter" far more often than for a specific
              pair of days, and two date fields cannot offer either. */}
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
          {/* 🛑 Always rendered, disabled when there is nothing to clear. Gating
              it on `dirty` re-flowed the whole row the moment somebody typed one
              character into the search. */}
          <Tooltip content='Clear all'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Clear all'
              disabled={!dirty}
              onClick={() =>
                onChange({
                  ...EMPTY_PAYOUT_FILTERS,
                  sourceAccountId: filters.sourceAccountId,
                  status: filters.status,
                })
              }>
              <CircleX />
            </Button>
          </Tooltip>
        </ListToolbarGroup>
      </ListToolbar>
    </div>
  )
}
