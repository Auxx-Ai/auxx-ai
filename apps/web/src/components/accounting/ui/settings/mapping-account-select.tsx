// apps/web/src/components/accounting/ui/settings/mapping-account-select.tsx
'use client'

import type { GlAccountSubtypeValue, GlAccountTypeValue } from '@auxx/lib/accounting/ledger/client'
import { Command, CommandDetailItem, CommandGroup, CommandInput } from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { useMemo, useState } from 'react'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { AccountLabel } from '../account-label'
import { GlAccountList, useChartAccounts } from '../gl-account-picker'

/** A mapped account id, `'inherit'` (falls through, see {@link inheritedAccountName}), `'unused'` (role marked unused), or `null` (not mapped). */
export type MappingAccountValue = string | 'inherit' | 'unused' | null

export interface MappingAccountSelectProps {
  value: MappingAccountValue
  onChange: (value: string | 'inherit') => void
  /** `null`/`undefined` drops the Inherit option — the `bank` role has no default (task 58 §3 rule 3). */
  inheritedAccountName?: string | null
  filterTypes?: GlAccountTypeValue[]
  /** Pins the list to one subtype beside `filterTypes` — `bank`/`clearing` (task 58 §3 rule 4). */
  subtypePin?: GlAccountSubtypeValue
  disabled?: boolean
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
}: MappingAccountSelectProps) {
  const { accounts: allAccounts, isLoading } = useChartAccounts()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const accounts = useMemo(
    () =>
      subtypePin ? allAccounts.filter((account) => account.subtype === subtypePin) : allAccounts,
    [allAccounts, subtypePin]
  )

  // The two sentinels are strings too, so a plain `typeof value === 'string'` would
  // mistake them for an account id.
  const accountIdValue = value === 'inherit' || value === 'unused' || value === null ? null : value
  const selected = useMemo(
    () => accounts.find((account) => account.id === accountIdValue) ?? null,
    [accounts, accountIdValue]
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
          hasValue={value === 'inherit' ? hasInherit : !!selected}
          placeholder={value === 'unused' ? 'Unused' : 'Select account…'}
          asCombobox
          className='h-7 w-60'>
          {value === 'inherit' ? (
            <span className='truncate text-sm'>{inheritLabel}</span>
          ) : (
            selected && <AccountLabel account={selected} density='compact' className='text-sm' />
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
        </Command>
      </PopoverContent>
    </Popover>
  )
}
