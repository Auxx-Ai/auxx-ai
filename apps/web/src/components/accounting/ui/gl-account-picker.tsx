// apps/web/src/components/accounting/ui/gl-account-picker.tsx

'use client'

import {
  type ChartAccountRow,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
} from '@auxx/lib/postings/client'
import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo, useState } from 'react'
import { accountTypeLabel } from '~/components/accounting/ui/settings/accounts-types'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { api } from '~/trpc/react'

/**
 * Reads the org's chart of accounts through `ledger.chartAccounts`.
 *
 * ⚠️ `listChartAccounts` (the lib read behind this procedure) filters
 * `archivedAt IS NULL` server-side, so an archived `gl_account` never reaches
 * this hook at all: there is no per-row flag to check for it. The only
 * "disabled for a reason" case this data can express is `isActive: false`
 * (deactivated but not archived), which is what {@link GlAccountPicker}
 * renders disabled below.
 */
export function useChartAccounts() {
  const query = api.ledger.chartAccounts.useQuery()
  return {
    accounts: (query.data ?? []) as ChartAccountRow[],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

export interface GlAccountPickerProps {
  /** The selected account's CODE, or null. Never an id. */
  value: string | null
  /** Fires with the chosen account's CODE, or null on clear. */
  onChange: (code: string | null) => void
  /** Restrict the list to these statement classifications. */
  filterTypes?: GlAccountTypeValue[]
  disabled?: boolean
  placeholder?: string
  className?: string
  triggerProps?: PickerTriggerOptions
}

/**
 * GlAccountPicker
 *
 * A single-select combobox over the org's chart of accounts
 * (`ledger.chartAccounts`), grouped by statement classification in the
 * standard order ({@link GL_ACCOUNT_TYPES}: asset, liability, equity,
 * revenue, expense). Option label is `code · name`. Value in and out is the
 * account CODE, never an id - that is what `resolveRoles` and the manual
 * entry builder take (decision `P2`: a posting line names an account by code
 * with no foreign key).
 *
 * 🛑 A deactivated account renders in its group, disabled, with the reason
 * as a visible tooltip, never simply dropped from the list. This is the
 * documented trap in `plans/accounting/ui-plan.md` §4.2: a person choosing an
 * account needs to see that `1310` exists and is off-limits, not wonder why
 * it vanished. An ARCHIVED account cannot appear this way (see
 * {@link useChartAccounts}), because the server excludes it before this
 * component ever sees it.
 *
 * Not built on `AsyncOptionPicker`/`MultiSelectPicker`: neither exposes a
 * headed group list together with a per-option disabled state and reason,
 * both required here, and `packages/lib`'s dependency rules keep this file
 * from reaching past `~/components/ui/picker-trigger` to change either
 * shared picker for one caller. Composed directly from the same `Command` +
 * `PickerTrigger asCombobox` primitives those pickers already use, so the
 * trigger and popover chrome still match every other picker in the app.
 */
export function GlAccountPicker({
  value,
  onChange,
  filterTypes,
  disabled = false,
  placeholder = 'Select account…',
  className,
  triggerProps,
}: GlAccountPickerProps) {
  const { accounts, isLoading } = useChartAccounts()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const groups = useMemo(
    () => groupAccountsByType(accounts, filterTypes, search),
    [accounts, filterTypes, search]
  )

  const selected = useMemo(
    () => accounts.find((account) => account.code === value) ?? null,
    [accounts, value]
  )

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setSearch('')
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : handleOpenChange}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'outline'}
          size={triggerProps?.size}
          hasValue={!!selected}
          placeholder={placeholder}
          showClear={triggerProps?.showClear ?? true}
          hideIcon={triggerProps?.hideIcon}
          onClear={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          asCombobox
          className={cn('h-auto min-h-8', className, triggerProps?.className)}>
          {selected && (
            <span className='flex min-w-0 items-center gap-1.5 truncate text-sm'>
              <span className='shrink-0 font-mono text-muted-foreground text-xs'>
                {selected.code}
              </span>
              <span className='truncate'>{selected.name}</span>
            </span>
          )}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),18rem)] p-0'
        align='start'>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Search accounts…'
            value={search}
            onValueChange={setSearch}
            loading={isLoading}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Loading…' : 'No accounts match.'}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.type} heading={accountTypeLabel(group.type)}>
                {group.accounts.map((account) => (
                  <CommandDetailItem
                    key={account.code}
                    value={account.code}
                    title={`${account.code} · ${account.name}`}
                    description={
                      account.isActive
                        ? undefined
                        : 'This account is inactive and cannot be posted to.'
                    }
                    disabled={!account.isActive}
                    selected={account.code === value}
                    selectionMode='check'
                    className={cn(!account.isActive && 'opacity-60')}
                    onSelect={() => {
                      if (!account.isActive) return
                      onChange(account.code)
                      handleOpenChange(false)
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** One statement-classification section of the picker's option list. */
interface AccountGroup {
  type: GlAccountTypeValue
  accounts: ChartAccountRow[]
}

/**
 * Groups the chart in {@link GL_ACCOUNT_TYPES} (statement) order, applying
 * `filterTypes` and a case-insensitive code/name search. Empty groups are
 * dropped rather than rendered with a heading and nothing under it.
 *
 * Pure and exported so grouping/ordering can be unit-tested without a tRPC
 * provider.
 */
export function groupAccountsByType(
  accounts: ChartAccountRow[],
  filterTypes: GlAccountTypeValue[] | undefined,
  search: string
): AccountGroup[] {
  const allowed = filterTypes ? new Set(filterTypes) : null
  const needle = search.trim().toLowerCase()
  const matches = (account: ChartAccountRow) =>
    !needle ||
    account.code.toLowerCase().includes(needle) ||
    account.name.toLowerCase().includes(needle)

  return GL_ACCOUNT_TYPES.filter((type) => !allowed || allowed.has(type))
    .map((type) => ({
      type,
      accounts: accounts.filter((account) => account.accountType === type && matches(account)),
    }))
    .filter((group) => group.accounts.length > 0)
}
