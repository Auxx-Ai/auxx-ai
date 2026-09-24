// apps/web/src/components/accounting/ui/settings/mapping-account-select.tsx
'use client'

import {
  accountPath,
  type GlAccountSubtypeValue,
  type GlAccountTypeValue,
} from '@auxx/lib/accounting/ledger/client'
import {
  Command,
  CommandDetailItem,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { AccountLabel } from '../account-label'
import { formatAccountPath } from '../account-label-format'
import { ChartAccountCreateDialog } from '../chart-account-create-dialog'
import { GlAccountList, useChartAccounts } from '../gl-account-picker'

/** A mapped account id, `'inherit'` (falls through, see {@link inheritedAccountName}), `'unused'` (role marked unused), or `null` (not mapped). */
export type MappingAccountValue = string | 'inherit' | 'unused' | null

/** A draft's "mint a new account under `mintLabel`" choice; never a stored value. */
export const MINT_ACCOUNT_VALUE = '__mint'

export interface MappingAccountSelectProps {
  value: MappingAccountValue
  onChange: (value: string | 'inherit') => void
  /** `null`/`undefined` drops the Inherit option — the `bank` role has no default (task 58 §3 rule 3). */
  inheritedAccountName?: string | null
  filterTypes?: GlAccountTypeValue[]
  /** Pins the list to one subtype beside `filterTypes` — `bank`/`clearing` (task 58 §3 rule 4). */
  subtypePin?: GlAccountSubtypeValue
  disabled?: boolean
  /** Offers "Create `<mintLabel>`" above the chart, selecting {@link MINT_ACCOUNT_VALUE}. */
  mintLabel?: string
  /** Merged over the trigger's default `h-7 w-60`. */
  triggerClassName?: string
}

/**
 * {@link GlAccountPicker} with one extra option pinned above the chart —
 * `Inherit · <account>`, in the `AccessRowSelect` treatment
 * (`permissions/ui/access-tree-row.tsx`) — the Mapping tab's row-level
 * control (task 59 §2.2, §6).
 */
export function MappingAccountSelect({
  value,
  onChange,
  inheritedAccountName,
  filterTypes,
  subtypePin,
  disabled = false,
  mintLabel,
  triggerClassName,
}: MappingAccountSelectProps) {
  const { accounts: allAccounts, isLoading } = useChartAccounts()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // A sibling of the Popover, never inside its content: Radix unmounts closed
  // popover content, and the click that opens the dialog closes the popover.
  const [createOpen, setCreateOpen] = useState(false)

  const accounts = useMemo(
    () =>
      subtypePin ? allAccounts.filter((account) => account.subtype === subtypePin) : allAccounts,
    [allAccounts, subtypePin]
  )

  // The two sentinels are strings too, so a plain `typeof value === 'string'` would
  // mistake them for an account id.
  const accountIdValue =
    value === 'inherit' || value === 'unused' || value === MINT_ACCOUNT_VALUE || value === null
      ? null
      : value
  const selected = useMemo(
    () => accounts.find((account) => account.id === accountIdValue) ?? null,
    [accounts, accountIdValue]
  )
  // Ancestors only, no leaf (D8) - `AccountLabel`'s `path` prop appends the
  // leaf itself, and it feeds only the tooltip, so `Checking` under two banks
  // stays distinguishable on hover without widening this trigger.
  const selectedAncestors = useMemo(
    () => (selected ? accountPath(accounts, selected.id).slice(0, -1) : []),
    [accounts, selected]
  )

  const hasInherit = inheritedAccountName !== undefined && inheritedAccountName !== null
  const inheritLabel = hasInherit ? `Inherit · ${inheritedAccountName}` : 'Inherit'

  function select(next: string | 'inherit') {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant='transparent'
          size='sm'
          hasValue={
            value === 'inherit'
              ? hasInherit
              : value === MINT_ACCOUNT_VALUE
                ? !!mintLabel
                : !!selected
          }
          placeholder={value === 'unused' ? 'Unused' : 'Select account…'}
          asCombobox
          className={cn('h-7 w-60', triggerClassName)}>
          {value === 'inherit' ? (
            <span className='truncate text-sm'>{inheritLabel}</span>
          ) : value === MINT_ACCOUNT_VALUE ? (
            <span className='truncate text-sm'>New · {mintLabel}</span>
          ) : (
            selected && (
              <AccountLabel
                account={selected}
                density='compact'
                path={
                  selectedAncestors.length > 0
                    ? formatAccountPath(selectedAncestors, selected)
                    : undefined
                }
                className='text-sm'
              />
            )
          )}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),18rem)] p-0'
        align='start'>
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder='Search accounts…'
            value={search}
            onValueChange={setSearch}
            loading={isLoading}
          />
          {mintLabel && (
            <CommandGroup>
              <CommandDetailItem
                value='__mint'
                title={`Create ${mintLabel}`}
                selected={value === MINT_ACCOUNT_VALUE}
                selectionMode='check'
                onSelect={() => select(MINT_ACCOUNT_VALUE)}
              />
            </CommandGroup>
          )}
          {hasInherit && (
            <CommandGroup>
              <CommandDetailItem
                value='__inherit'
                title={inheritLabel}
                selected={value === 'inherit'}
                selectionMode='check'
                onSelect={() => select('inherit')}
              />
            </CommandGroup>
          )}
          <GlAccountList
            accounts={accounts}
            isLoading={isLoading}
            search={search}
            filterTypes={filterTypes}
            selectBy='id'
            value={accountIdValue}
            onSelect={select}
          />
          {/* Outside the list, so it survives an empty search - the moment an
              account is missing is when it is needed. */}
          <CommandGroup className='border-t' aria-label='Add account'>
            <CommandItem
              value='__add-blank'
              onSelect={() => {
                setOpen(false)
                setCreateOpen(true)
              }}
              className='h-7.5 cursor-pointer'>
              <Plus className='text-muted-foreground' />
              <span>New account</span>
            </CommandItem>
          </CommandGroup>
        </Command>
      </PopoverContent>
      <ChartAccountCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultAccountType={filterTypes?.length === 1 ? filterTypes[0] : undefined}
        defaultSubtype={subtypePin}
        onCreated={(account) => select(account.id)}
      />
    </Popover>
  )
}
