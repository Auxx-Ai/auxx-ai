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
import { AccountLabel } from '~/components/accounting/ui/account-label'
import {
  accountMatchesSearch,
  formatAccountLabel,
} from '~/components/accounting/ui/account-label-format'
import { accountTypeLabel } from '~/components/accounting/ui/settings/accounts-types'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useChartAccounts } from './use-chart-accounts'

export { useChartAccounts }

export interface GlAccountPickerProps {
  /** The selected account's CODE or id, depending on {@link selectBy}. */
  value: string | null
  /** Fires with the chosen account's CODE or id (per {@link selectBy}), or null on clear. */
  onChange: (value: string | null) => void
  /** Restrict the list to these statement classifications. */
  filterTypes?: GlAccountTypeValue[]
  /**
   * What `value`/`onChange` carry. Defaults to `'code'`, which is every caller
   * that still names an account the `P2` way (a manual journal line, a
   * write-off). Pass `'id'` for the six registry pointers converted by
   * `plans/accounting/tasks/15-the-account-id-is-the-identity.md` §4
   * (`bank_account.glAccount`, `bank_rule.glAccount`,
   * `bank_transaction.glAccount`/`suggestedGlAccount`,
   * `vendor_bill_line.glAccount`), which store the `gl_account` instance id.
   */
  selectBy?: 'code' | 'id'
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
 * revenue, expense). The option label comes from `formatAccountLabel` and
 * reads name-only when the account has no code. Value in and out is the
 * account CODE by default - what `resolveRoles` and the manual entry builder
 * take (decision `P2`: a posting line names an account by code with no
 * foreign key) - or the account ID when `selectBy="id"` is passed, for the
 * six registry pointers task 15 §4 converted to hold an id instead.
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
  selectBy = 'code',
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
    () =>
      accounts.find((account) => (selectBy === 'id' ? account.id : account.code) === value) ?? null,
    [accounts, value, selectBy]
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
          // Defaults to the in-panel shape, which is what nearly every caller
          // wants: this picker almost always sits in a `FieldPanelRow`, where an
          // outlined trigger draws a second box inside the row's own. A caller
          // that needs a bordered, content-width trigger passes
          // `triggerProps={{ variant: 'outline' }}` and its own className.
          variant={triggerProps?.variant ?? 'transparent'}
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
          className={cn('h-auto min-h-8 w-full ps-0 pe-1', className, triggerProps?.className)}>
          {selected && <AccountLabel account={selected} className='text-sm' />}
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
                {group.accounts.map((account) => {
                  const optionValue = selectBy === 'id' ? account.id : account.code
                  return (
                    <CommandDetailItem
                      key={account.id}
                      value={account.id}
                      title={formatAccountLabel(account)}
                      description={
                        account.isActive
                          ? undefined
                          : 'This account is inactive and cannot be posted to.'
                      }
                      disabled={!account.isActive}
                      selected={optionValue === value}
                      selectionMode='check'
                      className={cn(!account.isActive && 'opacity-60')}
                      onSelect={() => {
                        if (!account.isActive) return
                        onChange(optionValue)
                        handleOpenChange(false)
                      }}
                    />
                  )
                })}
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

  return GL_ACCOUNT_TYPES.filter((type) => !allowed || allowed.has(type))
    .map((type) => ({
      type,
      accounts: accounts.filter(
        (account) => account.accountType === type && accountMatchesSearch(account, search)
      ),
    }))
    .filter((group) => group.accounts.length > 0)
}
