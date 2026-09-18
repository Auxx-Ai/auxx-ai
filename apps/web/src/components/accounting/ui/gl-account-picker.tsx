// apps/web/src/components/accounting/ui/gl-account-picker.tsx

'use client'

import {
  type ChartAccountRow,
  GL_ACCOUNT_TYPES,
  type GlAccountTypeValue,
} from '@auxx/lib/accounting/ledger/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandDetailItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { BookOpen, Link2, Link2Off, Plus, Sparkles, Unlink2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import {
  accountMatchesSearch,
  formatAccountLabel,
} from '~/components/accounting/ui/account-label-format'
import {
  type AccountLinkState,
  accountTypeColor,
  accountTypeIconId,
  accountTypeLabel,
} from '~/components/accounting/ui/settings/accounts-types'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useAccess } from '~/providers/capabilities-provider'
import { ChartAccountCreateDialog } from './chart-account-create-dialog'
import { ChartPacksDialog } from './settings/chart-packs-dialog'
import { useAccountLinkStates } from './use-account-link-states'
import { useChartAccounts } from './use-chart-accounts'

export { useChartAccounts }

/** What a caller's `value`/`onChange`/`onSelect` carries - see {@link GlAccountPickerProps.selectBy}. */
export type GlAccountSelectBy = 'code' | 'id'

/**
 * Props shared by every account list/body variant below - everything
 * `GlAccountList` needs to render one filtered, grouped, disabled-aware list.
 */
export interface GlAccountListProps {
  accounts: ChartAccountRow[]
  isLoading: boolean
  /** Search text - the caller owns the input (`CommandInput` in {@link GlAccountPickerBody}, or an external one in a spreadsheet-cell caller). */
  search: string
  filterTypes?: GlAccountTypeValue[]
  selectBy?: GlAccountSelectBy
  /** The selected account's code or id, per {@link selectBy}. */
  value: string | null
  /** Fires with the picked account's code or id, per {@link selectBy}. Never called for an inactive account. */
  onSelect: (value: string) => void
  /**
   * Link state per account id, from {@link useAccountLinkStates}. Omit (or pass
   * undefined) to draw no link marks at all.
   *
   * 🛑 Undefined is the RIGHT answer twice over: nothing is connected, or the
   * provider round trip has not landed. A mark on a row the provider has not
   * answered for yet is a claim about the org, and drawing it mid-load makes it
   * a false one.
   */
  linkStates?: ReadonlyMap<string, AccountLinkState>
  /** Names the connected system in the link tooltip. `'QuickBooks Online'`. */
  providerLabel?: string | null
}

/**
 * The list portion alone - grouped `CommandGroup`s of `CommandDetailItem`s,
 * no `CommandInput` and no `<Command>` shell. Exposed so a caller with its
 * OWN search surface (an external `<input>`, not cmdk's) can drop this
 * straight into whatever `<Command>` it already owns - `journal-lines.tsx`'s
 * spreadsheet-cell account picker does exactly this.
 */
export function GlAccountList({
  accounts,
  isLoading,
  search,
  filterTypes,
  selectBy = 'code',
  value,
  onSelect,
  linkStates,
  providerLabel,
}: GlAccountListProps) {
  const groups = useMemo(
    () => groupAccountsByType(accounts, filterTypes, search),
    [accounts, filterTypes, search]
  )

  return (
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
                // The group's classification, drawn on every row in it. Both
                // strings come from `GL_ACCOUNT_TYPE_META` through
                // `accounts-types.ts`, so the glyph and the colour here are the
                // same pair the chart list, the role map and the type badge
                // draw - the one table that exists so those cannot drift apart.
                iconId={accountTypeIconId(group.type)}
                color={accountTypeColor(group.type)}
                title={formatAccountLabel(account)}
                description={
                  account.isActive ? undefined : 'This account is inactive and cannot be posted to.'
                }
                secondary={
                  linkStates && (
                    <AccountLinkMark
                      state={linkStates.get(account.id) ?? 'unlinked'}
                      providerLabel={providerLabel ?? null}
                    />
                  )
                }
                disabled={!account.isActive}
                selected={optionValue === value}
                selectionMode='check'
                className={cn(!account.isActive && 'opacity-60')}
                onSelect={() => {
                  // `optionValue` is null only for a `selectBy='code'` caller
                  // hitting an account with no code - nothing to select by.
                  if (!account.isActive || !optionValue) return
                  onSelect(optionValue)
                }}
              />
            )
          })}
        </CommandGroup>
      ))}
    </CommandList>
  )
}

/**
 * Search input + {@link GlAccountList} - WITHOUT a surrounding `<Command>`
 * shell. Exposed (the `ResourceCommandBody` idiom) so a caller that already
 * owns a `<Command>` can embed the input-plus-list pair without nesting two
 * `Command`s. {@link GlAccountPickerContent} is the standalone wrapper around
 * this for the ordinary popover-trigger case.
 */
export function GlAccountPickerBody({
  accounts,
  isLoading,
  search,
  onSearchChange,
  filterTypes,
  selectBy,
  value,
  onSelect,
  linkStates,
  providerLabel,
  autoFocus,
}: Omit<GlAccountListProps, 'search'> & {
  search: string
  onSearchChange: (search: string) => void
  autoFocus?: boolean
}) {
  return (
    <>
      <CommandInput
        autoFocus={autoFocus}
        placeholder='Search accounts…'
        value={search}
        onValueChange={onSearchChange}
        loading={isLoading}
      />
      <GlAccountList
        accounts={accounts}
        isLoading={isLoading}
        search={search}
        filterTypes={filterTypes}
        selectBy={selectBy}
        value={value}
        onSelect={onSelect}
        linkStates={linkStates}
        providerLabel={providerLabel}
      />
    </>
  )
}

/**
 * {@link GlAccountPickerBody} wrapped in its own `<Command>` shell - a
 * complete, standalone "search + pick" surface for a caller that isn't
 * threading it into a popover (or wants its own positioning around it).
 * {@link GlAccountPicker} is this behind a `PickerTrigger` popover, which is
 * what nearly every caller actually wants.
 */
export function GlAccountPickerContent({
  className,
  onAddFromCatalogue,
  onAddBlank,
  ...props
}: Omit<GlAccountListProps, 'search' | 'linkStates' | 'providerLabel'> & {
  className?: string
  search?: string
  onSearchChange?: (search: string) => void
  autoFocus?: boolean
  /** Opens the catalogue picker. Omit to leave the footer's first row out. */
  onAddFromCatalogue?: () => void
  /** Opens the blank-account dialog. Omit to leave the footer's second row out. */
  onAddBlank?: () => void
}) {
  const [internalSearch, setInternalSearch] = useState('')
  const { can } = useAccess()
  // 🛑 Gated HERE rather than at each caller, so a new caller cannot forget it.
  // `ledgerView` is what gets you a picker at all; `ledgerControl` is the
  // narrower rung every chart write is gated on server-side. Somebody with
  // `ledgerView` alone gets a read-only list rather than two rows that 403.
  const canAdd = can(PermissionKey.ledgerControl) && !!(onAddFromCatalogue || onAddBlank)
  // 🛑 The provider round trip is owned HERE, not by `GlAccountPicker`, and not
  // by `GlAccountList`. This component mounts only when a picker is actually
  // open (Radix unmounts closed `PopoverContent`, and `journal-lines.tsx` mounts
  // it per open cell), so an org that never opens an account picker never pays
  // for it - while `GlAccountList` stays pure and testable without a tRPC
  // provider. React Query dedupes the key, so several open at once are still
  // one request.
  const links = useAccountLinkStates()
  return (
    <Command shouldFilter={false} className={className}>
      <GlAccountPickerBody
        {...props}
        search={props.search ?? internalSearch}
        onSearchChange={props.onSearchChange ?? setInternalSearch}
        // Undefined until the map is BOTH connected and landed - see `linkStates`.
        linkStates={links.ready ? links.byAccountId : undefined}
        providerLabel={links.providerLabel}
      />
      {/* 🛑 Pinned OUTSIDE `CommandList`, the same shape `view-selector.tsx:313`
          uses: a chart of two hundred accounts must scroll UNDER these rows
          rather than push them past the list's own max height, which is exactly
          where somebody who has just failed to find an account is looking.
          Outside the list they also survive an empty search - `CommandEmpty`
          renders inside it - so "no accounts match" and "add one" are on screen
          together.
          🛑 The catalogue is listed FIRST, the order `chart-list.tsx` argues
          for: most of what a person reaches for here is a standard account that
          already exists in the catalogue, and leading with the blank row sends
          them off to type a code and a type that were written down already. */}
      {canAdd && (
        <CommandGroup className='border-t' aria-label='Add account'>
          {onAddFromCatalogue && (
            <CommandItem
              value='__add-from-catalogue'
              onSelect={onAddFromCatalogue}
              className='h-7.5 cursor-pointer'>
              <BookOpen className='text-muted-foreground' />
              <span>From catalogue</span>
            </CommandItem>
          )}
          {onAddBlank && (
            <CommandItem value='__add-blank' onSelect={onAddBlank} className='h-7.5 cursor-pointer'>
              <Plus className='text-muted-foreground' />
              <span>Blank account</span>
            </CommandItem>
          )}
        </CommandGroup>
      )}
    </Command>
  )
}

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
   * `plans/accounting/tasks/done/15-the-account-id-is-the-identity.md` §4
   * (`bank_account.glAccount`, `bank_rule.glAccount`,
   * `bank_transaction.glAccount`/`suggestedGlAccount`,
   * `vendor_bill_line.glAccount`), which store the `gl_account` instance id.
   */
  selectBy?: GlAccountSelectBy
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
 *
 * `GlAccountPickerContent`/`GlAccountPickerBody`/`GlAccountList` above are
 * this picker's own `ResourcePickerContent`/`ResourceCommandBody` split -
 * peel one back whenever a caller needs the search+list without this
 * particular button-and-popover shell (`journal-lines.tsx`'s spreadsheet
 * cell uses `GlAccountList` directly, behind its own inline `<input>`).
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
  // 🛑 Both dialogs are siblings of the `Popover`, never children of its
  // content: Radix unmounts closed popover content, so a dialog opened from a
  // footer row would be torn down by the very click that opened it.
  const [catalogueOpen, setCatalogueOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const selected = useMemo(
    () =>
      accounts.find((account) => (selectBy === 'id' ? account.id : account.code) === value) ?? null,
    [accounts, value, selectBy]
  )

  function handleOpenChange(next: boolean) {
    setOpen(next)
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
        <GlAccountPickerContent
          accounts={accounts}
          isLoading={isLoading}
          filterTypes={filterTypes}
          selectBy={selectBy}
          value={value}
          onSelect={(next) => {
            onChange(next)
            handleOpenChange(false)
          }}
          onAddFromCatalogue={() => {
            handleOpenChange(false)
            setCatalogueOpen(true)
          }}
          onAddBlank={() => {
            handleOpenChange(false)
            setCreateOpen(true)
          }}
        />
      </PopoverContent>

      <ChartPacksDialog open={catalogueOpen} onOpenChange={setCatalogueOpen} accounts={accounts} />
      <ChartAccountCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        // A picker restricted to one classification already knows the answer -
        // the clearing-account pickers are all `filterTypes={['asset']}`. More
        // than one and there is nothing to presume.
        defaultAccountType={filterTypes?.length === 1 ? filterTypes[0] : undefined}
        // 🛑 Selected by the SAME key this picker reports, not always the id.
        // A `selectBy='code'` caller handed an id would store a value its own
        // option list can never match, and the trigger would go blank.
        onCreated={(account) => {
          const next = selectBy === 'id' ? account.id : account.code
          if (next) onChange(next)
        }}
      />
    </Popover>
  )
}

/** The glyph, tone and sentence for one {@link AccountLinkState}. */
const LINK_MARKS: Record<
  AccountLinkState,
  { icon: typeof Link2; className: string; tooltip: (where: string) => string }
> = {
  linked: {
    icon: Link2,
    className: 'text-muted-foreground',
    tooltip: (where) => `Linked to ${where}`,
  },
  suggested: {
    icon: Sparkles,
    className: 'text-amber-600 dark:text-amber-500',
    tooltip: (where) => `Suggested match in ${where}, not confirmed yet`,
  },
  broken: {
    icon: Unlink2,
    className: 'text-destructive',
    tooltip: (where) => `Its ${where} account is gone or no longer matches - re-link it`,
  },
  unlinked: {
    icon: Link2Off,
    className: 'text-muted-foreground/50',
    tooltip: (where) => `Not linked to ${where}`,
  },
}

/**
 * Whether one account is linked to the connected accounting system, as a mark
 * on its picker row.
 *
 * 🛑 Every state draws SOMETHING, including `unlinked`. "No mark" must never be
 * the way a reader learns an account is linked - the same rule the Chart of
 * accounts list's badge follows. The picker draws an icon rather than that
 * badge because a row here is one line beside an account name, and four words
 * of chrome per row would crowd out the name they describe.
 *
 * ⚠️ Not a control. The `Button` is here for its size and hit area (the tooltip
 * needs a real target); it is out of the tab order and swallows its own click
 * so that hitting it cannot select the row underneath.
 */
function AccountLinkMark({
  state,
  providerLabel,
}: {
  state: AccountLinkState
  providerLabel: string | null
}) {
  const mark = LINK_MARKS[state]
  const text = mark.tooltip(providerLabel ?? 'the accounting system')
  return (
    <SimpleTooltip content={text}>
      <Button
        type='button'
        variant='ghost'
        size='icon-xs'
        tabIndex={-1}
        aria-label={text}
        onClick={(event) => event.stopPropagation()}
        // 🛑 Sized to fit the row, not to `icon-xs`'s own `size-6`. A
        // `CommandItem` is `min-h-7` with `py-1`, so 20px is the tallest thing
        // that can sit in one without growing it - a 24px button makes every
        // account row in the list four pixels taller than every other picker's.
        className={cn('size-5 shrink-0 [&_svg]:size-3.5', mark.className)}>
        <mark.icon />
      </Button>
    </SimpleTooltip>
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
