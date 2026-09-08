// apps/web/src/components/accounting/ui/bank-account-picker.tsx

'use client'

import type { BankAccountRow } from '@auxx/lib/banking/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Landmark } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { BankInstitutionIcon } from '~/components/accounting/ui/bank-institution-icon'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { BankAccountConnectDialog } from './settings/bank-account-connect-dialog'
import { BankAccountManualDialog } from './settings/bank-account-manual-dialog'

/**
 * Reads the org's bank accounts through `banking.bankAccount.list`.
 *
 * The sibling of `useChartAccounts` in `gl-account-picker.tsx`, and the single
 * place this query is issued from for selection purposes. React Query dedupes
 * the key, so a screen that needs the rows for something else as well (the
 * review queue's empty state, the rules list's name lookup) can keep its own
 * `useQuery` without a second roundtrip.
 *
 * 🛑 **The query always asks for archived rows and the filtering happens here.**
 * One key across the whole app is what keeps the dedupe working; asking the
 * server twice with two different inputs would put a second roundtrip on every
 * screen that renders a picker beside a list. What each caller gets is decided
 * by `includeArchived`, which defaults to false so nothing existing changes.
 *
 * ⚠️ A caller that RESOLVES A NAME - a badge, a rules list - should pass
 * `{ includeArchived: true }`. An archived account that is still some record's
 * stored value has to keep rendering as itself, or the row goes blank and the
 * next save writes the blank back.
 *
 * `isLoading` is the query's `isPending`: what every call site actually wants
 * is "there is nothing to pick from yet", which is what disables the trigger
 * on first load.
 */
export function useBankAccounts(options: { includeArchived?: boolean } = {}) {
  const query = api.banking.bankAccount.list.useQuery({ includeArchived: true })
  const all = query.data ?? []
  const accounts = useMemo(
    () => (options.includeArchived ? all : all.filter((account) => !account.archivedAt)),
    // `all` is a fresh array identity only when the query data changes.
    [all, options.includeArchived]
  )
  return { accounts, isLoading: query.isPending }
}

/**
 * The ONE way a bank account is written down in this app:
 * `institution · name · ···last4`, each part dropped when the row does not
 * carry it.
 *
 * 🛑 Never falls back to the account id. The rules dialog used to render
 * `account.name ?? account.id`, which put a bare cuid in a dropdown for every
 * account that had not been named. An account with nothing at all to show
 * reads as "Bank account" - useless, but not alarming, and it still selects.
 *
 * Standalone and exported so an institution brand icon can be rendered beside
 * this string later without restructuring the picker.
 */
export function bankAccountLabel(
  account: Pick<BankAccountRow, 'institution' | 'name' | 'last4'>
): string {
  const label = [account.institution, account.name, account.last4 && `···${account.last4}`]
    .filter(Boolean)
    .join(' · ')
  return label || 'Bank account'
}

/**
 * The account as a ROW in the list: the bank is dropped when a heading above
 * already says it, and the last four is dropped always - a `Badge` renders it
 * through `renderItemAction`, so it lines up down the right edge instead of
 * trailing each name at a different x.
 *
 * 🛑 Repeating the institution under its own heading - "Bank of America" ›
 * "Bank of America · Business Adv Relationship" - is the exact noise grouping
 * exists to remove.
 */
function accountRowLabel(
  account: Pick<BankAccountRow, 'institution' | 'name'>,
  grouped: boolean
): string {
  const parts = grouped ? [account.name] : [account.institution, account.name]
  return parts.filter(Boolean).join(' · ') || 'Bank account'
}

/**
 * Accounts with no institution, headed last. Same wording as
 * `bank-accounts-list.tsx`, which groups the settings list the same way and for
 * the same reason.
 */
const NO_INSTITUTION = 'Other accounts'

/** The group an account belongs to: its institution, or the catch-all. */
function institutionOf(account: Pick<BankAccountRow, 'institution'>): string {
  return account.institution?.trim() || NO_INSTITUTION
}

/** The "no filter" row's option value. Never a real account id. */
const ALL_ACCOUNTS = '__all_accounts__'

export interface BankAccountPickerProps {
  /** The selected account's id, or null. */
  value: string | null
  /** Fires with the chosen account's id, or null on clear. Always a string. */
  onChange: (id: string | null) => void
  /** Drop one account from the list - a transfer cannot name its own account. */
  excludeId?: string | null
  /**
   * Render a leading "everything" row with this label (e.g. `'All accounts'`),
   * shown as selected while `value` is null. For a FILTER, where "no account"
   * is a real choice rather than an empty field.
   */
  allLabel?: string
  placeholder?: string
  disabled?: boolean
  triggerProps?: PickerTriggerOptions
  className?: string
}

/**
 * BankAccountPicker
 *
 * A single-select over the org's bank accounts (`banking.bankAccount.list`).
 * The counterpart to `GlAccountPicker`: that one names an account by CODE for a
 * posting line, this one names a `bank_account` by id for a feed, a rule scope
 * or a transfer leg.
 *
 * **Grouped by institution**, the way `bank-accounts-list.tsx` groups the
 * settings list: a login is per institution, so two accounts at one bank belong
 * together wherever they are shown.
 *
 * 🛑 Composed from `Popover` + `PickerTrigger` + `MultiSelectPicker` rather than
 * wrapping `FieldInputAdapter`, and grouping is the reason. The adapter renders
 * its trigger as `<TagsView options={options}>`, which forces the LIST row and
 * the TRIGGER to share one label - and those must differ here: a row under a
 * "Bank of America" heading must not repeat the bank, while the closed trigger
 * has no heading to borrow it from and must still say which bank it is. These
 * are the same primitives the adapter itself composes, so the chrome matches
 * every other picker in the app.
 *
 * The trigger is disabled while the list is still loading: an empty picker that
 * opens onto nothing reads as "you have no accounts", which is a different and
 * wrong answer.
 *
 * **Both creation doors are on the list's floor, in EVERY instance of this
 * picker** - the pair the settings page shows as two buttons: Connect a bank,
 * and Add manually. There is no prop to suppress them, filters included: a
 * reader who notices a missing account is looking at this list at the moment
 * they notice, and sending them to Settings to come back is the trip the rows
 * exist to remove. The one gate is `ledgerPost` (below), because the server has
 * one too.
 *
 * 🛑 Not one "Add a bank account" row opening a chooser - that is a dialog
 * whose only question is which dialog you wanted, and it buries connect, which
 * is the path that produces a live feed.
 */
export function BankAccountPicker({
  value,
  onChange,
  excludeId,
  allLabel,
  placeholder = 'Select account…',
  disabled = false,
  triggerProps,
  className,
}: BankAccountPickerProps) {
  // Archived rows come back, and the filter below drops all but the one that is
  // still this field's value. See the comment on `visible`.
  const { accounts, isLoading } = useBankAccounts({ includeArchived: true })
  const { can } = useAccess()
  const [open, setOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)

  const utils = api.useUtils()
  const connect = api.banking.connect.useMutation()
  const startConnection = useCallback(() => connect.mutateAsync(), [connect])

  // 🛑 `ledgerPost`, the same rung `bank-accounts-settings-page.tsx` gates its
  // whole page on: a bank account's mapping decides where cash lands on the
  // balance sheet. A `ledgerView` reader is offered neither row rather than a
  // server refusal after filling the form.
  const showCreate = can(PermissionKey.ledgerPost)

  const { options, groups, groupBy, last4ById, archivedIds, showGroups } = useMemo(() => {
    // 🛑 An archived account is out of the list, EXCEPT when it is the current
    // value. A rule scoped to an account somebody archived must still render its
    // own selection: a picker that silently shows empty over a stored id is one
    // where the next save rewrites the record to null and nobody sees it happen.
    const visible = accounts.filter(
      (account) => account.id !== excludeId && (!account.archivedAt || account.id === value)
    )
    const institutionById = new Map(visible.map((a) => [a.id, institutionOf(a)]))

    // Institutions alphabetically, the catch-all always last. `MultiSelectPicker`
    // appends any group id this list omits, so a missing entry degrades to an
    // unordered section rather than a dropped account.
    const institutions = [...new Set(institutionById.values())].sort((a, b) => {
      if (a === NO_INSTITUTION) return 1
      if (b === NO_INSTITUTION) return -1
      return a.localeCompare(b)
    })

    // 🛑 Headings only when there is more than one institution. A lone heading
    // over every row states what the reader already knows - and the rows under
    // it would drop the bank name for nothing.
    const grouped = institutions.length > 1

    const options: SelectOption[] = visible.map((account) => ({
      value: account.id,
      label: accountRowLabel(account, grouped),
    }))

    // The "everything" row sits in its own section above the first institution.
    // `heading` is optional, so a group id with none renders bare.
    if (allLabel) options.unshift({ value: ALL_ACCOUNTS, label: allLabel })

    // `heading` is a ReactNode, so the institution's brand mark hangs off the
    // heading - once per bank rather than once per row. `connectorId` comes from
    // any account in the group: a login is per institution, so they agree.
    const groups = [
      ...(allLabel ? [{ id: '' }] : []),
      ...institutions.map((id) => ({
        id,
        heading: (
          <span className='flex items-center gap-1.5'>
            <BankInstitutionIcon
              institution={id === NO_INSTITUTION ? null : id}
              connectorId={
                visible.find((a) => institutionOf(a) === id && a.connectorId)?.connectorId ?? null
              }
            />
            {id}
          </span>
        ),
      })),
    ]

    const groupBy = (opt: SelectOption) =>
      opt.value === ALL_ACCOUNTS ? '' : (institutionById.get(opt.value) ?? NO_INSTITUTION)

    const last4ById = new Map(visible.filter((a) => a.last4).map((a) => [a.id, a.last4 as string]))
    const archivedIds = new Set(visible.filter((a) => a.archivedAt).map((a) => a.id))

    return { options, groups, groupBy, last4ById, archivedIds, showGroups: grouped || !!allLabel }
  }, [accounts, excludeId, allLabel, value])

  const selected = useMemo(
    () => accounts.find((account) => account.id === value) ?? null,
    [accounts, value]
  )

  /** Open one of the dialogs, closing the list it was reached from. */
  const openDialog = useCallback((which: 'manual' | 'connect') => {
    setOpen(false)
    if (which === 'manual') setManualOpen(true)
    else setConnectOpen(true)
  }, [])

  return (
    <>
      <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger asChild>
          <PickerTrigger
            open={open}
            disabled={disabled || isLoading}
            variant={triggerProps?.variant ?? 'transparent'}
            size={triggerProps?.size}
            hasValue={!!selected}
            placeholder={allLabel ?? placeholder}
            // A filter clears by picking its own "All accounts" row, so the extra
            // affordance would be a second control for one decision.
            showClear={triggerProps?.showClear ?? !allLabel}
            hideIcon={triggerProps?.hideIcon}
            onClear={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            asCombobox
            className={cn('h-auto min-h-8 w-full ps-0 pe-1', className, triggerProps?.className)}>
            {/* The institution IS included here: a closed trigger has no heading
              above it to borrow the bank name from. */}
            {selected && (
              <span className='flex min-w-0 items-center gap-1.5'>
                <BankInstitutionIcon
                  institution={selected.institution}
                  connectorId={selected.connectorId}
                />
                <span className='truncate text-sm'>{accountRowLabel(selected, false)}</span>
                {selected.last4 && (
                  <Badge variant='outline' size='xs' className='shrink-0 font-mono'>
                    {selected.last4}
                  </Badge>
                )}
              </span>
            )}
          </PickerTrigger>
        </PopoverTrigger>
        <PopoverContent
          className='min-w-[max(var(--radix-popover-trigger-width),18rem)] p-0'
          align='start'>
          <MultiSelectPicker
            options={options}
            value={value ? [value] : allLabel ? [ALL_ACCOUNTS] : []}
            multi={false}
            canAdd={false}
            canManage={false}
            isLoading={isLoading}
            placeholder='Search accounts…'
            groupBy={showGroups ? groupBy : undefined}
            groups={showGroups ? groups : undefined}
            renderItemAction={(opt) => {
              // The one archived row this list can carry is the current value,
              // and it says so instead of showing its last four - the reader has
              // to be able to tell why an account nobody can pick is in here.
              if (archivedIds.has(opt.value)) {
                return (
                  <Badge variant='destructive' size='xs'>
                    Archived
                  </Badge>
                )
              }
              const last4 = last4ById.get(opt.value)
              return last4 ? (
                <Badge variant='outline' size='xs' className='font-mono'>
                  {last4}
                </Badge>
              ) : null
            }}
            onChange={(next) => {
              const picked = next[0] ?? null
              onChange(picked === ALL_ACCOUNTS ? null : picked)
            }}
            onSelectSingle={() => setOpen(false)}
            onCreate={showCreate ? () => openDialog('manual') : undefined}
            createLabel='Add manually'
            onBrowse={showCreate ? () => openDialog('connect') : undefined}
            browseLabel='Connect a bank'
            browseIcon={Landmark}
          />
        </PopoverContent>
      </Popover>

      {/* Siblings of the `Popover`, never children of its content: opening one of
        these closes the popover, and a dialog mounted inside it would unmount
        on the same click that opened it. */}
      <BankAccountManualDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        // The account was just added FROM this picker, so it becomes its value.
        // Making the operator reopen the list and find the row they just created
        // is the step this dialog was reached to avoid.
        //
        // ⚠️ On a FILTER that means the list narrows to an account with no
        // transactions yet, so the queue behind it reads empty. That is true
        // rather than broken, and one click on the "all" row undoes it.
        onCreated={(account) => onChange(account.id)}
      />
      <BankAccountConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onStart={startConnection}
        onConnected={async (connected) => {
          await utils.banking.bankAccount.list.invalidate()
          // 🛑 No auto-select. One login can bring back several accounts and the
          // flow answers a COUNT, not ids, so there is nothing here to choose
          // honestly - the list reopens carrying all of them.
          if (connected > 0) setOpen(true)
        }}
      />
    </>
  )
}
