// apps/web/src/components/accounting/ui/settings/chart-list.tsx
'use client'

// The left column of the Chart of accounts tab: search + "Add account" above a
// flat `TreeRow` list, with the phantom draft rendered as a final row.

import { ACCOUNT_ROLE_LABELS, type AccountRole } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Landmark, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import {
  accountTypeColor,
  accountTypeLabel,
  type ChartAccount,
  type ChartDraftHandle,
} from './accounts-types'

interface ChartListProps {
  accounts: ChartAccount[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Roles pointing at each account id. A non-empty list makes the row undeletable. */
  rolesByAccountId: Map<string, AccountRole[]>
  onAdd: () => void
  onDelete: (account: ChartAccount) => void
  onToggleActive: (account: ChartAccount) => void
  draft: ChartDraftHandle | null
}

export function ChartList({
  accounts,
  selectedId,
  onSelect,
  rolesByAccountId,
  onAdd,
  onDelete,
  onToggleActive,
  draft,
}: ChartListProps) {
  const [search, setSearch] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  async function handleDelete(account: ChartAccount) {
    const roles = rolesByAccountId.get(account.id) ?? []
    if (roles.length > 0) {
      // 🛑 Refused, naming the role. The chart is an editable template, not a
      // free-for-all: `resolveRoles` fails closed, so a silent delete here
      // becomes a refused close next month with no obvious cause.
      const named = roles.map((role) => `"${ACCOUNT_ROLE_LABELS[role]}"`).join(', ')
      toastError({
        title: 'Cannot delete this account',
        description:
          `${account.code} ${account.name} is mapped to the ${named} ` +
          `${roles.length === 1 ? 'role' : 'roles'}. Repoint ${roles.length === 1 ? 'it' : 'them'} ` +
          'on the Roles tab first, or mark the role unused.',
      })
      return
    }

    const confirmed = await confirm({
      title: 'Delete account?',
      description:
        `${account.code} ${account.name} will be removed from the chart. Posting lines that ` +
        'already name this code keep it, because a line stores the code with no foreign key.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    onDelete(account)
  }

  const filtered = search
    ? accounts.filter(
        (account) =>
          account.name.toLowerCase().includes(search.toLowerCase()) || account.code.includes(search)
      )
    : accounts

  return (
    <div className='flex flex-col gap-3 p-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search accounts...'
        />
        <Button variant='outline' size='sm' onClick={onAdd}>
          <Plus />
          Add account
        </Button>
      </div>

      {filtered.length === 0 && !draft ? (
        <div className='p-4 text-center text-muted-foreground text-sm'>
          {search ? 'No matches' : 'No accounts yet. Add the first one.'}
        </div>
      ) : (
        // `TREE_SECONDARY_NOTRUNCATE`: TreeRow's `secondary` slot truncates
        // (overflow-hidden) by default, which clips a Badge's pill edges and its
        // `ring-1 ring-current/35`. The class is exported by `tree-row.tsx` for
        // exactly this case and belongs on the container around the rows.
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
                    {roles.length > 0 && (
                      <span>
                        {roles.length} {roles.length === 1 ? 'role' : 'roles'}
                      </span>
                    )}
                  </span>
                }
                actions={
                  // `TreeRowButton`, never a raw icon Button: it owns the
                  // hover-fade, the sizing and the tooltip side, and it stops
                  // its own click. TreeRow wraps the whole `actions` slot in an
                  // `onClick={stopPropagation}` container (tree-row.tsx:315),
                  // so the Switch beside it cannot fire `onToggleOpen` either.
                  <div className='flex items-center gap-1'>
                    <TreeRowButton
                      tooltipText='Delete account'
                      variant='destructive'
                      onClick={() => void handleDelete(account)}>
                      <Trash2 />
                    </TreeRowButton>
                    <Switch
                      size='xs'
                      checked={account.isActive}
                      onCheckedChange={() => onToggleActive(account)}
                    />
                  </div>
                }
              />
            )
          })}

          {draft && !draft.recordId && (
            <TreeRow
              key={draft.draftId}
              icon={<Landmark className='size-4 text-muted-foreground' />}
              title={
                <span className='flex items-baseline gap-2'>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {draft.code || '----'}
                  </span>
                  <span className={cn('text-sm', !draft.name && 'text-muted-foreground italic')}>
                    {draft.name || 'Untitled account'}
                  </span>
                </span>
              }
              onToggleOpen={() => onSelect(draft.draftId)}
              rowClassName={cn(
                'bg-primary-100/50 hover:bg-primary-100',
                selectedId === draft.draftId && 'bg-primary-100 ring-1 ring-primary-200'
              )}
            />
          )}
        </div>
      )}
      <ConfirmDialog />
    </div>
  )
}
