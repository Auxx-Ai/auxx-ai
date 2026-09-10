// apps/web/src/components/accounting/ui/provider-account-picker.tsx

'use client'

import type { ChartAccountRow, ProviderAccount } from '@auxx/lib/postings/client'
import { GL_ACCOUNT_TYPES, type GlAccountTypeValue, isMappableTo } from '@auxx/lib/postings/client'
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
import {
  accountTypeLabel,
  formatProviderAccount,
} from '~/components/accounting/ui/settings/accounts-types'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'

export interface ProviderAccountPickerProps {
  /** The paired provider account's id, or null while unmapped. */
  value: string | null
  /** Fires with the chosen provider account's id, or null on clear (the unmap). */
  onChange: (value: string | null) => void
  /** The connected provider's whole chart. Empty with nothing connected. */
  accounts: readonly ProviderAccount[]
  /**
   * The LIVE local type and subtype being edited, not the saved ones. Somebody
   * who has just changed this account's type is picking for what it is NOW;
   * offering candidates for what it used to be would hand them a pairing the
   * server is about to refuse.
   */
  target: { accountType: GlAccountTypeValue | null; subtype: ChartAccountRow['subtype'] }
  disabled?: boolean
  placeholder?: string
  className?: string
  triggerProps?: PickerTriggerOptions
}

/**
 * ProviderAccountPicker
 *
 * A single-select combobox over the CONNECTED PROVIDER's chart, grouped by the
 * five statement classifications, for pairing one `gl_account` with one
 * provider account.
 *
 * 🛑 The sibling of `GlAccountPicker`, deliberately, and not a `Combobox`. Both
 * pickers sit on the same pane and perform the same act - name an account - so
 * a plain `CommandItem` list on one and a headed `CommandDetailItem` list on the
 * other made one screen read as two. This is the same `Command` +
 * `CommandDetailItem` + `PickerTrigger asCombobox` composition, so the trigger,
 * the grouping and the option shape all match.
 *
 * 🛑 An INCOMPATIBLE account renders in its group, disabled, with the reason
 * visible - never silently dropped. This is `GlAccountPicker`'s documented trap
 * turned around to face the provider: somebody looking for `1310 Inventory
 * Asset` needs to see that it exists and is off-limits, not wonder why it is
 * missing and assume the import lost it.
 *
 * ⚠️ Compatibility is a FILTER on what can be CHOSEN, never a tiebreak. A
 * candidate in the wrong statement section is unselectable at any confidence:
 * pairing a liability with a revenue account produces entries that BALANCE and
 * misstate the P&L, and the number somebody recognises gives them no way to
 * tell. `isMappableTo` is the one authority (`suggest-account-identities.ts`),
 * shared with the resolver, so the picker and the close cannot disagree.
 */
export function ProviderAccountPicker({
  value,
  onChange,
  accounts,
  target,
  disabled = false,
  placeholder = 'Select account…',
  className,
  triggerProps,
}: ProviderAccountPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const groups = useMemo(() => groupProviderAccountsByType(accounts, search), [accounts, search])

  const selected = useMemo(
    () => accounts.find((account) => account.id === value) ?? null,
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
          variant={triggerProps?.variant ?? 'transparent'}
          size={triggerProps?.size}
          hasValue={!!selected}
          placeholder={placeholder}
          // The clear IS the unmap: `null` is what `setAccountIdentity` takes to
          // mean "this pairing is off". A separate Unmap button would be a
          // second control for one act.
          showClear={triggerProps?.showClear ?? true}
          onClear={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
          asCombobox
          className={cn('h-auto min-h-8 w-full ps-0 pe-1', className, triggerProps?.className)}>
          {selected && <span className='truncate text-sm'>{formatProviderAccount(selected)}</span>}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),20rem)] p-0'
        align='start'>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder='Search the accounting system…'
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No accounts match.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.type} heading={accountTypeLabel(group.type)}>
                {group.accounts.map((account) => {
                  // 🛑 An account with no type yet makes NOTHING selectable.
                  // Every candidate is judged against the target's type, so
                  // treating "no type" as "anything goes" would offer the whole
                  // provider chart and let somebody pick a pairing the server
                  // refuses the moment the type is filled in.
                  const mappable = target.accountType
                    ? isMappableTo(
                        { accountType: target.accountType, subtype: target.subtype },
                        account
                      )
                    : false
                  return (
                    <CommandDetailItem
                      key={account.id}
                      value={account.id}
                      title={account.fullyQualifiedName}
                      // The provider's own number and type, which is what makes
                      // two same-named accounts tellable apart - and what says
                      // why an unselectable one is unselectable.
                      description={describeProviderAccount(account, mappable, target.accountType)}
                      disabled={!mappable}
                      selected={account.id === value}
                      selectionMode='check'
                      className={cn(!mappable && 'opacity-60')}
                      onSelect={() => {
                        if (!mappable) return
                        onChange(account.id)
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
interface ProviderAccountGroup {
  type: GlAccountTypeValue
  accounts: ProviderAccount[]
}

/**
 * The provider's chart in {@link GL_ACCOUNT_TYPES} (statement) order, with a
 * case-insensitive number/name search applied. Empty groups are dropped rather
 * than rendered with a heading and nothing under it.
 *
 * 🛑 Groups by the provider's `classification`, which is the field the
 * compatibility check reads. Grouping by its finer `accountType` would put an
 * account in a section the check does not consult, so a reader could not tell
 * from the heading whether a row was selectable.
 *
 * Pure and exported so grouping/ordering can be unit-tested without a provider.
 */
export function groupProviderAccountsByType(
  accounts: readonly ProviderAccount[],
  search: string
): ProviderAccountGroup[] {
  const needle = search.trim().toLowerCase()
  const matches = (account: ProviderAccount) =>
    !needle ||
    account.fullyQualifiedName.toLowerCase().includes(needle) ||
    (account.number ?? '').toLowerCase().includes(needle) ||
    account.accountType.toLowerCase().includes(needle)

  return GL_ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: accounts.filter(
      (account) => account.classification === type && account.active && matches(account)
    ),
  })).filter((group) => group.accounts.length > 0)
}

/**
 * The detail line under a provider account: its number and the provider's own
 * type, plus the reason when it cannot be chosen.
 *
 * ⚠️ Says what is WRONG, never just "unavailable". "QuickBooks types this as
 * Other Current Asset" tells somebody which account to look for instead; a bare
 * disabled row tells them the picker is broken.
 */
function describeProviderAccount(
  account: ProviderAccount,
  mappable: boolean,
  targetType: GlAccountTypeValue | null
): string {
  const facts = [account.number?.trim(), account.accountType].filter(Boolean).join(' · ')
  if (mappable) return facts
  if (!targetType) return `${facts} — choose this account's type first`
  if (account.classification !== targetType) {
    return `${facts} — ${account.classification} in the accounting system, so it cannot hold ${accountTypeLabel(targetType).toLowerCase()} postings`
  }
  return `${facts} — this type cannot hold the subtype of the account you are mapping`
}
