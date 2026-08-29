// apps/web/src/components/accounting/ui/settings/chart-list.tsx
'use client'

// The left column of the Chart of accounts tab: search and an Add button above a
// flat `TreeRow` list of the org's live `gl_account` rows, from
// `ledger.chartAccounts`.
//
// The chart WRITES now (`ledger.chartAccountCreate` / `Update` / `Remove`, all on
// `ledgerPost`). This list owns only the Add affordance and the phantom row; the
// fields, the removal and every refusal live in the detail pane, where a message
// has a row to land on.
//
// 🛑 The phantom row is what makes the draft's buffering visible. Between "Add
// account" and the Create button becoming enabled, the only evidence that
// anything is happening is this row tracking what is being typed - without it
// the person is filling in a form with no place in the list.

import type { AccountRole, ChartAccountRow } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Landmark, Plus } from 'lucide-react'
import { useState } from 'react'
import { accountTypeColor, accountTypeLabel, type ChartDraftHandle } from './accounts-types'

interface ChartListProps {
  accounts: ChartAccountRow[]
  /** True while `ledger.chartAccounts` is in flight. An empty chart and an
   *  unloaded one are different answers and must not render the same. */
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Roles pointing at each account id, for the "2 roles" note on a row. */
  rolesByAccountId: Map<string, AccountRole[]>
  /** The uncommitted draft, if any. Rendered as a phantom row at the top. */
  draft: ChartDraftHandle | null
  onAddDraft: () => void
}

export function ChartList({
  accounts,
  isLoading,
  selectedId,
  onSelect,
  rolesByAccountId,
  draft,
  onAddDraft,
}: ChartListProps) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? accounts.filter(
        (account) =>
          account.name.toLowerCase().includes(search.toLowerCase()) || account.code.includes(search)
      )
    : accounts

  // Hidden once `recordId` is stamped: the real row arrived with the invalidated
  // query, and rendering both would show the same account twice.
  const phantom = draft && !draft.recordId ? draft : null

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search accounts...'
          className='flex-1'
        />
        <Button variant='outline' size='sm' onClick={onAddDraft}>
          <Plus />
          Add account
        </Button>
      </div>

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 && !phantom ? (
        <EmptySection
          icon={<Landmark className='size-5' />}
          title={search ? 'No matches' : 'No accounts in the chart'}
          // ⚠️ This copy used to blame the entity migrations, and that stopped
          // being true: `gl_account`'s DEFINITION ships with every org, its ROWS
          // are provisioned on purpose from the setup wizard, so an empty chart
          // is now an ordinary state rather than a broken one.
          description={
            search
              ? undefined
              : 'Add accounts here, or let the accounting setup create the 29-account default chart for you.'
          }
        />
      ) : (
        // `TREE_SECONDARY_NOTRUNCATE`: TreeRow's `secondary` slot truncates
        // (overflow-hidden) by default, which clips a Badge's pill edges and its
        // `ring-1 ring-current/35`. The class is exported by `tree-row.tsx` for
        // exactly this case - a BADGE-shaped secondary, which is what this list
        // has. The role map's secondary carries a sentence instead, so it must
        // NOT wear this class or the sentence stops truncating and overflows.
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          {phantom && (
            <TreeRow
              key={phantom.draftId}
              icon={<Landmark className='size-4 text-muted-foreground' />}
              title={
                <span className='flex items-baseline gap-2'>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {phantom.code || '—'}
                  </span>
                  <span className='text-sm'>{phantom.name || 'New account'}</span>
                </span>
              }
              secondaryFill
              onToggleOpen={() => onSelect(phantom.draftId)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === phantom.draftId && 'bg-primary-100 ring-1 ring-primary-200'
              )}
              secondary={
                <span className='text-muted-foreground text-xs italic'>Not created yet</span>
              }
            />
          )}

          {filtered.map((account) => {
            const roles = rolesByAccountId.get(account.id) ?? []
            return (
              <TreeRow
                key={account.id}
                icon={<Landmark className='size-4 text-muted-foreground' />}
                title={
                  <span className='flex items-baseline gap-2'>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {account.code}
                    </span>
                    <span className='text-sm'>{account.name}</span>
                  </span>
                }
                secondaryFill
                onToggleOpen={() => onSelect(account.id)}
                rowClassName={cn(
                  'bg-primary-100/50 hover:bg-primary-100',
                  selectedId === account.id && 'bg-primary-100 ring-1 ring-primary-200',
                  !account.isActive && 'opacity-60'
                )}
                secondary={
                  <span className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                    <Badge variant={accountTypeColor(account.accountType)} size='xs'>
                      {accountTypeLabel(account.accountType)}
                    </Badge>
                    {!account.isActive && (
                      <Badge variant='outline' size='xs'>
                        Inactive
                      </Badge>
                    )}
                    {roles.length > 0 && (
                      <span>
                        {roles.length} {roles.length === 1 ? 'role' : 'roles'}
                      </span>
                    )}
                  </span>
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
