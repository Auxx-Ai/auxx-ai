// apps/web/src/components/accounting/ui/banking/review/review-toolbar.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { BankAccountRow } from '@auxx/lib/banking/client'
import { REVIEW_STATUS_LABELS, type ReviewQueueState } from '@auxx/lib/banking/review/client'
import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import { Input } from '@auxx/ui/components/input'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { CircleX } from 'lucide-react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'

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

/** The five statuses plus "everything", in the order a reviewer works through them. */
const STATES: { value: ReviewQueueState; label: string }[] = [
  { value: 'for_review', label: REVIEW_STATUS_LABELS.for_review },
  { value: 'suggested', label: REVIEW_STATUS_LABELS.suggested },
  { value: 'matched', label: REVIEW_STATUS_LABELS.matched },
  { value: 'coded', label: REVIEW_STATUS_LABELS.coded },
  { value: 'excluded', label: REVIEW_STATUS_LABELS.excluded },
  { value: 'all', label: 'All' },
]

const ALL_ACCOUNTS = '__all__'

interface ReviewToolbarProps {
  filters: ReviewFilters
  onChange: (next: ReviewFilters) => void
  accounts: BankAccountRow[]
  accountsLoading: boolean
}

/**
 * The queue's toolbar: account, state, search, date range, amount range
 * (plans/accounting/ui-plan.md §2.8).
 *
 * TWO `ListToolbar` rows inside one sticky block, not one row: the six-item
 * state `RadioTab` plus an account combobox plus search plus two dates plus two
 * amounts cannot share a line at any width a person actually uses, and
 * `ListToolbar`'s `overflow-x-auto` turns that into a horizontal scroll that
 * hides half the filters. Row one is what you are looking AT (account, then
 * which pile of it); row two is how you narrow it. The state `RadioTab` is
 * second on its row because the ACCOUNT is what a bookkeeper reconciles against
 * a statement.
 *
 * Both rows are `sticky={false}` because the wrapper is the sticky element -
 * two sticky rows would pin to the same `top-0` and cover each other.
 *
 * ⚠️ The amount inputs take DOLLARS, which the page converts once. Every figure
 * that crosses the wire is integer minor units; this is the one boundary where
 * a person's `12.50` becomes `1250`, and it is deliberately not two conventions.
 */
export function ReviewToolbar({
  filters,
  onChange,
  accounts,
  accountsLoading,
}: ReviewToolbarProps) {
  const set = <K extends keyof ReviewFilters>(key: K, value: ReviewFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const dirty =
    !!filters.search || !!filters.from || !!filters.to || !!filters.amountMin || !!filters.amountMax

  const clear = (
    <Button
      variant='ghost'
      size='sm'
      className='h-7'
      onClick={() =>
        onChange({
          ...EMPTY_REVIEW_FILTERS,
          bankAccountId: filters.bankAccountId,
          state: filters.state,
        })
      }>
      <CircleX />
      Clear
    </Button>
  )

  return (
    <div className='sticky top-0 z-10 shrink-0 backdrop-blur-sm'>
      <ListToolbar sticky={false}>
        <ListToolbarGroup className='shrink-0'>
          <Combobox
            options={[
              { value: ALL_ACCOUNTS, label: 'All accounts' },
              ...accounts.map((account) => ({
                value: account.id,
                label: [account.institution, account.name, account.last4 && `···${account.last4}`]
                  .filter(Boolean)
                  .join(' · '),
              })),
            ]}
            value={filters.bankAccountId ?? ALL_ACCOUNTS}
            onChangeValue={(value) => set('bankAccountId', value === ALL_ACCOUNTS ? null : value)}
            placeholder='Account'
            emptyText='No bank accounts yet'
            loading={accountsLoading}
            size='sm'
            variant='ghost'
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
                {state.label}
              </RadioTabItem>
            ))}
          </RadioTab>
        </ListToolbarGroup>
      </ListToolbar>

      <ListToolbar sticky={false}>
        <ListToolbarGroup className='min-w-40 flex-1'>
          <InputSearch
            value={filters.search}
            onChange={(event) => set('search', event.target.value)}
            placeholder='Search description'
            className='h-7'
          />
        </ListToolbarGroup>

        <ListToolbarGroup className='shrink-0'>
          <span className='shrink-0 text-muted-foreground text-xs'>Date</span>
          <DateFilter label='From' value={filters.from} onChange={(next) => set('from', next)} />
          <span className='shrink-0 text-muted-foreground text-xs'>to</span>
          <DateFilter label='To' value={filters.to} onChange={(next) => set('to', next)} />
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

        {dirty && <ListToolbarGroup className='shrink-0'>{clear}</ListToolbarGroup>}
      </ListToolbar>
    </div>
  )
}

/**
 * One end of the date range, on the app's own date input rather than a native
 * `<input type='date'>` so it matches every other date in the product.
 *
 * ⚠️ The value contract is the one `journal-entry-drawer.tsx` keeps: a calendar
 * day goes IN as `YYYY-MM-DDT00:00:00.000Z` and comes back OUT sliced to ten
 * characters. Handing the picker a bare `YYYY-MM-DD` reads as an instant and
 * lands a day early for every viewer west of UTC.
 */
function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className='w-40 shrink-0' role='group' aria-label={label}>
      <FieldInputAdapter
        fieldType={FieldType.DATE}
        value={value ? `${value}T00:00:00.000Z` : null}
        onChange={(next) => onChange(typeof next === 'string' ? next.slice(0, 10) : '')}
        triggerProps={{ size: 'sm', className: 'h-7 w-40 px-2 text-xs' }}
      />
    </div>
  )
}
