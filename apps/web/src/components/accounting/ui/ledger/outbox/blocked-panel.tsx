// apps/web/src/components/accounting/ui/ledger/outbox/blocked-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the BLOCKED tab (75-D1). One row per
// `MoneyTransaction` the ledger refused: the money moved, nothing was written,
// and `postingBlockedReason` has been holding the reason where nobody could
// read it.
//
// 🛑 The refusal is rendered in `postEntry`'s own words, never paraphrased. An
// unmapped role additionally gets the remedy card `entry-blockers.tsx` already
// draws for `account_unmapped`, whose per-role row deep-links to that role
// under Accounting > Settings > Accounts > Roles - that IS the Map action.

import type { CloseBlockerItem } from '@auxx/lib/accounting/ledger/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api, type RouterOutputs } from '~/trpc/react'
import { EntryBlockers } from '../entry-blockers'
import { formatAccountingDate, formatMinor } from '../format'

/** The server's row, never rebuilt here - `listBlockedMovements` owns the shape. */
type BlockedMovementRow = RouterOutputs['ledger']['listBlockedMovements']['rows'][number]

const PAGE_SIZE = 50

const PURPOSE_LABEL: Record<BlockedMovementRow['purpose'], string> = {
  customer_receipt: 'Customer payment',
  customer_refund: 'Customer refund',
  vendor_payment: 'Vendor payment',
  vendor_refund: 'Vendor refund',
}

/**
 * The roles named in an `account_unmapped` refusal, as the remedy card's items.
 *
 * ⚠️ Parsed back out of the sentence because the reason is all the movement
 * stores - `resolve-roles.ts` writes one `'role' (Label) …` clause per offending
 * role, and widening `MoneyTransaction` to carry the list is not worth a column.
 */
function unmappedRoleItems(reason: string): CloseBlockerItem[] {
  const items: CloseBlockerItem[] = []
  for (const match of reason.matchAll(/'([a-z0-9_]+)'\s*(\([^)]*\))?([^']*)/g)) {
    const role = match[1]
    if (!role || items.some((item) => item.ref === role)) continue
    items.push({
      key: 'unmapped_role',
      label: match[2] ? `${role} ${match[2]}` : role,
      remedy: match[3]?.trim() || 'It is not mapped to any account.',
      ref: role,
    })
  }
  return items
}

interface BlockedPanelProps {
  /** Owned by `outbox-panel.tsx` so every tab's empty copy is written in one place. */
  emptyDescription: string
  bookTimeZone: string
}

/** Every parked movement, newest refusal first, with Map and Retry per row. */
export function BlockedPanel({ emptyDescription, bookTimeZone }: BlockedPanelProps) {
  const utils = api.useUtils()
  const [page, setPage] = useState(0)
  const blockedQuery = api.ledger.listBlockedMovements.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const rows = blockedQuery.data?.rows ?? []
  const total = blockedQuery.data?.total ?? 0
  const loading = blockedQuery.isPending

  const retry = api.ledger.retryBlockedMovement.useMutation({
    onSuccess: (result) => {
      if (result.status !== 'accepted')
        toastError({
          title: 'Still not posted',
          description: 'reason' in result ? result.reason : 'It is waiting for approval.',
        })
      void utils.ledger.listBlockedMovements.invalidate()
      void utils.ledger.listDrafts.invalidate()
      void utils.ledger.listPostings.invalidate()
    },
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  if (!loading && total === 0)
    return (
      <div className='flex flex-1 flex-col p-3'>
        <EmptyState
          icon={CircleAlert}
          title='Nothing has been refused'
          description={emptyDescription}
        />
      </div>
    )

  return (
    <div className='flex flex-1 flex-col gap-3 p-3 pb-16'>
      <TreeRowList
        items={rows}
        loading={loading}
        skeletonCount={4}
        className='gap-px'
        getKey={(row: BlockedMovementRow) => row.id}
        renderRow={(row: BlockedMovementRow) => {
          const busy = retry.isPending && retry.variables?.moneyTransactionId === row.id
          const date = row.occurredOn ?? row.occurredAt?.toISOString() ?? null
          return (
            <div className='flex flex-col gap-1.5'>
              <TreeRow
                className={TREE_SECONDARY_NOTRUNCATE}
                icon={<CircleAlert className='size-4 text-destructive' />}
                title={
                  <span className='flex min-w-0 items-center gap-1.5'>
                    <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                      {date ? formatAccountingDate(date, bookTimeZone) : ''}
                    </span>
                    <span className='truncate text-sm'>
                      {PURPOSE_LABEL[row.purpose]}
                      {row.partyName ? ` - ${row.partyName}` : ''}
                    </span>
                  </span>
                }
                secondary={
                  // The unmapped shape says it again on its own card below, so
                  // the row line is for every other refusal.
                  row.reasonKind === 'account_unmapped' ? (
                    <span className='text-muted-foreground text-xs'>
                      An account role is not mapped
                    </span>
                  ) : (
                    <span className='text-muted-foreground text-xs' title={row.reason}>
                      {row.reason}
                    </span>
                  )
                }
                actions={
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='font-mono text-xs tabular-nums'>
                      {formatMinor(row.amountMinor, row.currency)}
                    </span>
                    <TreeRowButton
                      persistent
                      tooltipText='Post this movement again'
                      disabled={busy}
                      onClick={() => retry.mutate({ moneyTransactionId: row.id })}>
                      <RefreshCw className={busy ? 'animate-spin' : undefined} />
                    </TreeRowButton>
                  </div>
                }
              />
              {row.reasonKind === 'account_unmapped' && (
                <div className='px-1'>
                  {/* The framed card, not `bare`: its rows start OPEN, and the
                      Map button on each one is the remedy this tab exists for. */}
                  <EntryBlockers
                    blockers={[
                      {
                        status: 'account_unmapped',
                        error: row.reason,
                        items: unmappedRoleItems(row.reason),
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          )
        }}
      />

      {total > PAGE_SIZE && (
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-xs tabular-nums'>
            {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant='outline'
            size='sm'
            className='ml-auto'
            disabled={page === 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}>
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((prev) => prev + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
