// apps/web/src/components/accounting/ui/settings/bank-accounts-list.tsx
'use client'

// The left column of Accounting > Settings > Bank accounts (ui-plan.md §2.7):
// one `TreeRow` per `bank_account`, grouped into a `Section` per institution.
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
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Building2, CreditCard, Landmark, PlugZap, Plus, RefreshCw, Upload } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
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
  connecting: boolean
  /** The account whose sync is in flight, so only its button spins. */
  syncingId: string | null
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
  connecting,
  syncingId,
}: BankAccountsListProps) {
  const [search, setSearch] = useState('')

  const groups = useMemo(() => groupByInstitution(accounts, search), [accounts, search])

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
          <InputSearch
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search accounts...'
          />
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
        groups.map((group) => (
          <Section
            key={group.institution}
            title={group.institution}
            // 🛑 Reconnect belongs on the LOGIN, not on a row. Two accounts at one
            // bank share a credential, so reconnecting either reconnects both - and
            // offering the action twice would read as two different actions with no
            // way to tell that it is one. Rendered only when something in the group
            // actually needs it, so a healthy login carries no spare button.
            description={
              group.accounts.length === 1 ? '1 account' : `${group.accounts.length} accounts`
            }
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
            }
            initialOpen>
            <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
              {group.accounts.map((account) => (
                <TreeRow
                  key={account.id}
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
                    selectedId === account.id && 'bg-primary-100 ring-1 ring-primary-200'
                  )}
                  actions={
                    account.connectorId ? (
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
                      <BankAccountStatusChip account={account} />
                      {account.glAccountCode ? (
                        <Badge variant='outline' size='xs' className='font-mono'>
                          {account.glAccountCode}
                        </Badge>
                      ) : (
                        <Badge variant='destructive' size='xs'>
                          Unmapped
                        </Badge>
                      )}
                    </span>
                  }
                />
              ))}
            </div>
          </Section>
        ))
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
    .map(([institution, group]) => ({ institution, accounts: group }))
}
