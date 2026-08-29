// apps/web/src/components/accounting/ui/settings/chart-list.tsx
'use client'

// The left column of the Chart of accounts tab: search above a flat `TreeRow`
// list of the org's live `gl_account` rows, from `ledger.chartAccounts`.
//
// 🛑 READ-ONLY, and deliberately so. There is no create, update, archive or
// activate procedure for a `gl_account` through any surface yet, so this list
// offers no Add button, no delete and no active/inactive switch. An affordance
// that looked writable and was not is worse than no affordance: it teaches
// somebody the chart is theirs to edit here, and then loses the edit.

import type { AccountRole, ChartAccountRow } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Landmark } from 'lucide-react'
import { useState } from 'react'
import { accountTypeColor, accountTypeLabel } from './accounts-types'

interface ChartListProps {
  accounts: ChartAccountRow[]
  /** True while `ledger.chartAccounts` is in flight. An empty chart and an
   *  unloaded one are different answers and must not render the same. */
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Roles pointing at each account id, for the "2 roles" note on a row. */
  rolesByAccountId: Map<string, AccountRole[]>
}

export function ChartList({
  accounts,
  isLoading,
  selectedId,
  onSelect,
  rolesByAccountId,
}: ChartListProps) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? accounts.filter(
        (account) =>
          account.name.toLowerCase().includes(search.toLowerCase()) || account.code.includes(search)
      )
    : accounts

  return (
    <div className='flex flex-col gap-3 p-3'>
      <InputSearch
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder='Search accounts...'
      />

      {isLoading ? (
        <EmptySection loading />
      ) : filtered.length === 0 ? (
        <EmptySection
          icon={<Landmark className='size-5' />}
          title={search ? 'No matches' : 'No accounts in the chart'}
          description={
            search
              ? undefined
              : 'The chart is provisioned with the org. If it is empty, the accounting entity migrations have not run for this organization.'
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
