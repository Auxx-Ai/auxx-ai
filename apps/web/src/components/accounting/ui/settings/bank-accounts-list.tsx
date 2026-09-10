// apps/web/src/components/accounting/ui/settings/bank-accounts-list.tsx
'use client'

// The left column of Accounting > Settings > Bank accounts (ui-plan.md §2.7):
// one `TreeRow` per `bank_account`, nested under one `TreeRow` per institution.
//
// 🛑 Grouped by INSTITUTION, not flat, because a reconnect is per LOGIN and not
// per account. Two Bank of America accounts under one login share a credential;
// reconnecting one reconnects both, and a flat list would offer the action twice
// with no way to tell that it is the same action.
//
// 🛑 The GL mapping badge is on the ROW, not only in the editor. An unmapped
// bank account is the single most consequential unfinished state in this
// subsystem - every reconciliation and every balance-sheet cash figure depends
// on it - and a state that can only be discovered by selecting each row in turn
// is a state that stays unfinished.
//
// The status chip uses `resolveSyncStatus` for a connected account and a plain
// badge for a manual one. A manual account has no connector, so a "synced" or
// "action needed" vocabulary would be a claim about a feed that does not exist.

import type { BankAccountRow } from '@auxx/lib/banking/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import {
  ArchiveRestore,
  Building2,
  CreditCard,
  Landmark,
  PlugZap,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { BankInstitutionIcon } from '~/components/accounting/ui/bank-institution-icon'
import { useChartAccounts } from '~/components/accounting/ui/gl-account-picker'
import { asConnectorStatus } from '~/components/data-connectors/ui/connector-status'
import { ConnectorStatusLine } from '~/components/data-connectors/ui/connector-status-line'
import { EmptyState } from '~/components/global/empty-state'

interface BankAccountsListProps {
  accounts: BankAccountRow[]
  /** True while `banking.bankAccount.list` is in flight. An empty list and an
   *  unloaded one are different answers and must not render the same. */
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onConnect: () => void
  onAddManually: () => void
  /** Queue a manual sync for one account's feed. */
  onSync: (bankAccountId: string) => void
  /** Re-authenticate a whole LOGIN. Offered on the section, never on a row. */
  onReconnect: (bankAccountId: string) => void
  /** Bring an archived account back. Offered on the archived row alone. */
  onRestore: (bankAccountId: string) => void
  connecting: boolean
  /** The account whose sync is in flight, so only its button spins. */
  syncingId: string | null
  /** The account whose restore is in flight. */
  restoringId: string | null
  /**
   * Whether `accounts` currently carries the archived rows.
   *
   * 🛑 The page owns the state and the filtering. This component renders what it
   * is given; a second filter here would be a second answer to which rows exist.
   */
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  /** How many archived accounts the org holds, so the toggle can say so. */
  archivedCount: number
}

/** Institutions in a stable order, with unnamed ones last under one heading. */
const NO_INSTITUTION = 'Other accounts'

export function BankAccountsList({
  accounts,
  isLoading,
  selectedId,
  onSelect,
  onConnect,
  onAddManually,
  onSync,
  onReconnect,
  onRestore,
  connecting,
  syncingId,
  restoringId,
  showArchived,
  onShowArchivedChange,
  archivedCount,
}: BankAccountsListProps) {
  const [search, setSearch] = useState('')
  /**
   * Institutions the reader has COLLAPSED, so the default is open and an
   * institution that appears later - a new connection, or a group revealed by
   * clearing the search - is open too. Tracking the open ones instead would
   * hide every group nobody had touched yet.
   */
  const [collapsed, setCollapsed] = useState<string[]>([])

  const groups = useMemo(() => groupByInstitution(accounts, search), [accounts, search])

  // 🛑 `glAccount` is stored as the `gl_account` id, not a code (task 15 §4), so
  // the badge below has to resolve it. One `ledger.chartAccounts` fetch for the
  // whole list, React-Query cached - never a lookup per row.
  const { accounts: chartAccounts } = useChartAccounts()
  const chartAccountById = useMemo(
    () => new Map(chartAccounts.map((account) => [account.id, account])),
    [chartAccounts]
  )

  const toggleInstitution = (institution: string) =>
    setCollapsed((current) =>
      current.includes(institution)
        ? current.filter((value) => value !== institution)
        : [...current, institution]
    )

  const buttons = (
    <div className='flex items-center gap-2'>
      <Button variant='outline' size='sm' onClick={onConnect} loading={connecting}>
        <Landmark />
        Connect a bank
      </Button>
      <Button variant='outline' size='sm' onClick={onAddManually}>
        <Plus />
        Add manually
      </Button>
    </div>
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      {/* ⚠️ Two rows, not one, and NOT a wrapping row. `chart-list.tsx` puts its
          search beside a single button; two buttons squeeze the box to about
          forty pixels. And a `flex-wrap` row is worse than either: `InputSearch`
          wraps its input in a `relative flex flex-1` div, so on the second line
          that wrapper stretches the full width and swallows the buttons' clicks
          - the row looked right and neither button could be pressed. */}
      {/* Hidden while the list is empty: the `EmptyState` below carries the same
          two buttons, and showing four of them on a blank screen reads as two
          different pairs of actions. */}
      {accounts.length > 0 && (
        <>
          <div className='flex items-center gap-2'>{buttons}</div>
          {/* The search and the archived toggle share a row, which is safe where
              the two BUTTONS above were not: `ButtonSwitch` at `xs` is narrow
              enough that `InputSearch`'s `flex-1` still has room, and the row
              never wraps - so the wrapper cannot stretch over a second line and
              swallow the toggle's clicks. */}
          <div className='flex items-center gap-2'>
            <InputSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search accounts...'
            />
            {/* Offered only when there is something behind it. An always-present
                toggle over an empty set advertises a state most orgs never
                reach, and archiving is meant to be the quiet default rather
                than a mode. */}
            {archivedCount > 0 && (
              <ButtonSwitch
                label={`Show archived (${archivedCount})`}
                size='xs'
                checked={showArchived}
                onCheckedChange={onShowArchivedChange}
                className='shrink-0'
              />
            )}
          </div>
        </>
      )}

      {isLoading ? (
        <EmptySection loading />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title='No bank accounts yet'
          description={
            <>
              A bank account is where the feed meets your chart of accounts. Connect one to pull
              transactions automatically, or add one by hand and import statements into it.
            </>
          }
          button={buttons}
        />
      ) : groups.length === 0 ? (
        <EmptySection icon={<Landmark className='size-5' />} title='No matches' />
      ) : (
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {groups.map((group) => (
            // One institution is one parent row with its accounts nested at depth
            // 1, so the connector line does the grouping. Open unless the reader
            // collapsed it: an account is what this screen is for, and a closed
            // group hides the Unmapped badge that is the whole reason the badge
            // sits on the row rather than in the editor.
            <TreeRow
              key={group.institution}
              expandable
              isOpen={!collapsed.includes(group.institution)}
              onToggleOpen={() => toggleInstitution(group.institution)}
              // The institution's brand mark when the feed proved the name, the
              // generic bank icon otherwise - which is every manually added
              // account, deliberately.
              icon={
                <BankInstitutionIcon
                  institution={group.institution === NO_INSTITUTION ? null : group.institution}
                  connectorId={
                    group.accounts.find((account) => account.connectorId)?.connectorId ?? null
                  }
                />
              }
              title={<span className='truncate font-medium text-sm'>{group.institution}</span>}
              // 🛑 The count is of LIVE accounts. An archived one is not an
              // account this bank is feeding any more, and counting it would
              // make "Show archived" appear to add accounts to the login.
              secondary={
                <span className='text-muted-foreground text-xs'>
                  {group.liveCount === 1 ? '1 account' : `${group.liveCount} accounts`}
                </span>
              }
              // 🛑 Reconnect belongs on the LOGIN, not on a row. Two accounts at one
              // bank share a credential, so reconnecting either reconnects both - and
              // offering the action twice would read as two different actions with no
              // way to tell that it is one. Rendered only when something in the group
              // actually needs it, so a healthy login carries no spare button.
              actions={
                needsReconnect(group.accounts) ? (
                  <Button
                    variant='outline'
                    size='xs'
                    onClick={(event) => {
                      event.stopPropagation()
                      const target = group.accounts.find(needsAccountReconnect) ?? group.accounts[0]
                      if (target) onReconnect(target.id)
                    }}>
                    <PlugZap />
                    Reconnect
                  </Button>
                ) : undefined
              }>
              <TreeRowList
                items={group.accounts}
                getKey={(account: BankAccountRow) => account.id}
                renderRow={(account: BankAccountRow) => (
                  <TreeRow
                    depth={1}
                    icon={
                      account.type === 'credit' ? (
                        <CreditCard className='size-4 text-muted-foreground' />
                      ) : (
                        <Building2 className='size-4 text-muted-foreground' />
                      )
                    }
                    // ⚠️ No `secondaryFill`. It lets the TITLE keep its natural
                    // width, which is right for a chart row (`1310 Raw
                    // Materials`) and wrong here: `Bank of America · Business Adv
                    // Relationship ···5381` is longer than the whole list column,
                    // so the badges were pushed clean out of the pane. The title
                    // truncates and the badges size to content instead - the
                    // status and the mapping are what the row exists to show, and
                    // the full name is one click away in the editor.
                    title={<span className='truncate text-sm'>{rowLabel(account)}</span>}
                    onToggleOpen={() => onSelect(account.id)}
                    rowClassName={cn(
                      'bg-primary-100/50 hover:bg-primary-100',
                      // Dimmed rather than styled apart: an archived account is
                      // still the same row, and it has to stay legible enough to
                      // find the one you meant to restore.
                      account.archivedAt && 'opacity-60',
                      selectedId === account.id && 'bg-primary-100 ring-1 ring-primary-200'
                    )}
                    actions={
                      account.archivedAt ? (
                        // Restore, and nothing else. Sync on an archived account
                        // would start a feed for a row that is out of every list.
                        <TreeRowButton
                          tooltipText='Restore'
                          disabled={restoringId === account.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            onRestore(account.id)
                          }}>
                          <ArchiveRestore />
                        </TreeRowButton>
                      ) : account.connectorId ? (
                        <TreeRowButton
                          tooltipText={
                            account.status === 'disconnected'
                              ? 'Reconnect the bank first'
                              : 'Sync now'
                          }
                          // 🛑 Disabled on a disconnected feed rather than hidden. One
                          // click on a disconnected connector moves it to `error`, which
                          // discards the Disconnected banner AND puts it outside every
                          // repair path - so the server refuses it and the button says so
                          // before the click (#2051).
                          disabled={account.status === 'disconnected' || syncingId === account.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            onSync(account.id)
                          }}>
                          <RefreshCw className={syncingId === account.id ? 'animate-spin' : ''} />
                        </TreeRowButton>
                      ) : undefined
                    }
                    secondary={
                      <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs'>
                        {account.archivedAt ? (
                          <Badge variant='secondary' size='xs'>
                            Archived
                          </Badge>
                        ) : (
                          <BankAccountStatusChip account={account} />
                        )}
                        {(() => {
                          const mapped = account.glAccountId
                            ? chartAccountById.get(account.glAccountId)
                            : null
                          if (mapped) {
                            return (
                              <Badge variant='outline' size='xs' className='font-mono'>
                                <AccountLabel account={mapped} density='chip' />
                              </Badge>
                            )
                          }
                          if (account.glAccountId) {
                            return (
                              <Badge variant='destructive' size='xs'>
                                Account not found
                              </Badge>
                            )
                          }
                          return (
                            <Badge variant='destructive' size='xs'>
                              Unmapped
                            </Badge>
                          )
                        })()}
                      </span>
                    }
                  />
                )}
              />
            </TreeRow>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <p className='px-1 text-muted-foreground text-xs'>
          Missing history?{' '}
          <Link className='underline' href='/app/accounting/banking/import'>
            <Upload className='mr-1 inline size-3' />
            Import statements
          </Link>{' '}
          into any account here.
        </p>
      )}
    </div>
  )
}

/**
 * The row's status.
 *
 * 🛑 A manual account gets a plain badge, never the sync vocabulary. "Synced 2h
 * ago" on an account with no feed is a false claim, and "action needed" on one
 * is a demand with nothing to act on.
 */
function BankAccountStatusChip({ account }: { account: BankAccountRow }) {
  if (account.connector) {
    return (
      <ConnectorStatusLine
        status={asConnectorStatus(account.connector.status)}
        error={account.connector.error}
        lastSyncedAt={account.connector.lastSyncedAt}
      />
    )
  }
  if (account.status === 'disconnected') {
    return (
      <Badge variant='destructive' size='xs'>
        Disconnected
      </Badge>
    )
  }
  return (
    <Badge variant='outline' size='xs'>
      Manual
    </Badge>
  )
}

/**
 * What a ROW says: `Business Adv Relationship ···5381`.
 *
 * The institution is deliberately absent - the `Section` heading above the row
 * already carries it, and repeating it consumed most of a 420px column and
 * truncated the part that identifies the account. {@link accountTitle} keeps the
 * full form for the editor header, where there is no heading to lean on.
 */
export function rowLabel(account: BankAccountRow): string {
  const name = account.name?.trim() || 'Untitled account'
  return account.last4 ? `${name} ···${account.last4}` : name
}

/** `Bank of America - Business Adv Relationship ...5381`, minus whatever is null. */
export function accountTitle(account: BankAccountRow): string {
  const parts = [account.institution, account.name].filter(Boolean)
  const head = parts.join(' · ') || 'Untitled account'
  return account.last4 ? `${head} ···${account.last4}` : head
}

/** A login needs re-authentication when any account under it has lost its feed. */
function needsAccountReconnect(account: BankAccountRow): boolean {
  return (
    account.status === 'disconnected' ||
    account.connector?.status === 'disconnected' ||
    account.connector?.status === 'error'
  )
}

/** Whether to offer Reconnect for a whole institution group. */
export function needsReconnect(accounts: BankAccountRow[]): boolean {
  return accounts.some(needsAccountReconnect)
}

interface InstitutionGroup {
  institution: string
  accounts: BankAccountRow[]
  /** Live accounts only. What the heading counts; see the `secondary` above. */
  liveCount: number
}

/**
 * Group by institution, filtered by a case-insensitive search over the whole
 * title. Groups left empty by the search are dropped rather than rendered with
 * a heading and nothing under it.
 *
 * Pure and exported so grouping can be unit-tested without a tRPC provider.
 */
export function groupByInstitution(accounts: BankAccountRow[], search: string): InstitutionGroup[] {
  const needle = search.trim().toLowerCase()
  const matched = needle
    ? accounts.filter((account) => accountTitle(account).toLowerCase().includes(needle))
    : accounts

  const byInstitution = new Map<string, BankAccountRow[]>()
  for (const account of matched) {
    const key = account.institution?.trim() || NO_INSTITUTION
    const list = byInstitution.get(key) ?? []
    list.push(account)
    byInstitution.set(key, list)
  }

  return [...byInstitution.entries()]
    .sort(([a], [b]) => (a === NO_INSTITUTION ? 1 : b === NO_INSTITUTION ? -1 : a.localeCompare(b)))
    .map(([institution, group]) => ({
      institution,
      accounts: group,
      liveCount: group.filter((account) => !account.archivedAt).length,
    }))
}
