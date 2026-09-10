// apps/web/src/components/accounting/ui/settings/payment-gateways-list.tsx
'use client'

// The left column of Accounting > Settings > Payment gateways (task 13 §5.3).
// Copies `bank-accounts-list.tsx` almost exactly, minus the institution
// grouping - a gateway has no login to group by, so this is one flat list.
//
// 🛑 The clearing-account badge is on the ROW, not only in the editor. Same
// argument as the bank account list: which account a gateway reconciles
// into is the one thing this screen exists to answer, and a state that can
// only be discovered by selecting each row in turn stays unfinished.

import type { PaymentGatewayRow } from '@auxx/lib/payment-gateways/client'
import { PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS } from '@auxx/lib/payment-gateways/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { CreditCard, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AccountLabel } from '~/components/accounting/ui/account-label'
import { useChartAccounts } from '~/components/accounting/ui/gl-account-picker'
import { EmptyState } from '~/components/global/empty-state'

interface PaymentGatewaysListProps {
  gateways: PaymentGatewayRow[]
  isLoading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
  showArchived: boolean
  onShowArchivedChange: (next: boolean) => void
  /** How many closed gateways the org holds, so the toggle can say so. */
  closedCount: number
}

export function PaymentGatewaysList({
  gateways,
  isLoading,
  selectedId,
  onSelect,
  onAdd,
  showArchived,
  onShowArchivedChange,
  closedCount,
}: PaymentGatewaysListProps) {
  const [search, setSearch] = useState('')

  // `clearingGlAccountId` is stored as the `gl_account` id (task 15 §4 shape),
  // so the badge below has to resolve it. One `ledger.chartAccounts` fetch for
  // the whole list, React-Query cached - never a lookup per row.
  const { accounts: chartAccounts } = useChartAccounts()
  const chartAccountById = useMemo(
    () => new Map(chartAccounts.map((account) => [account.id, account])),
    [chartAccounts]
  )

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return gateways
    return gateways.filter(
      (gateway) =>
        gateway.name.toLowerCase().includes(needle) ||
        gateway.handles.some((handle) => handle.toLowerCase().includes(needle))
    )
  }, [gateways, search])

  const addButton = (
    <Button variant='outline' size='sm' className='shrink-0' onClick={onAdd}>
      <Plus />
      Add gateway
    </Button>
  )

  return (
    <div className='flex flex-col gap-3 p-3'>
      {/* One row, `chart-list.tsx`'s shape: a SINGLE button beside the search
          still leaves the box room, which is exactly what stopped
          `bank-accounts-list.tsx` from doing the same (it carries two, and two
          squeeze the input to about forty pixels). Never `flex-wrap` either -
          `InputSearch` wraps its input in a `relative flex flex-1` div, so on a
          second line that wrapper stretches full width and swallows the
          button's clicks. */}
      {gateways.length > 0 && (
        <div className='flex items-center gap-2'>
          <InputSearch
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search gateways...'
            className='flex-1'
          />
          {/* Offered only when there is something behind it - an always-present
              toggle over an empty set advertises a state most orgs never reach. */}
          {closedCount > 0 && (
            <ButtonSwitch
              label={`Show closed (${closedCount})`}
              size='xs'
              checked={showArchived}
              onCheckedChange={onShowArchivedChange}
              className='shrink-0'
            />
          )}
          {addButton}
        </div>
      )}

      {isLoading ? (
        <EmptySection loading />
      ) : gateways.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title='No payment gateways yet'
          description={
            <>
              A payment gateway is a record carrying its own clearing account - Shopify Payments,
              Affirm, or any rail this store has ever run. Add one to route its shipments there
              instead of the default card clearing account.
            </>
          }
          button={addButton}
        />
      ) : visible.length === 0 ? (
        <EmptySection icon={<CreditCard className='size-5' />} title='No matches' />
      ) : (
        <div className={cn('flex flex-col gap-0.5', TREE_SECONDARY_NOTRUNCATE)}>
          <TreeRowList
            items={visible}
            getKey={(gateway: PaymentGatewayRow) => gateway.id}
            renderRow={(gateway: PaymentGatewayRow) => {
              const mapped = chartAccountById.get(gateway.clearingGlAccountId)
              return (
                <TreeRow
                  icon={<CreditCard className='size-4 text-muted-foreground' />}
                  title={
                    <span className='truncate text-sm'>{gateway.name || 'Untitled gateway'}</span>
                  }
                  onToggleOpen={() => onSelect(gateway.id)}
                  rowClassName={cn(
                    'bg-primary-100/50 hover:bg-primary-100',
                    gateway.status === 'closed' && 'opacity-60',
                    selectedId === gateway.id && 'bg-primary-100 ring-1 ring-primary-200'
                  )}
                  secondary={
                    <span className='flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs'>
                      {gateway.handles.map((handle) => (
                        <Badge key={handle} variant='secondary' size='xs' className='font-mono'>
                          {handle}
                        </Badge>
                      ))}
                      {mapped ? (
                        <Badge variant='outline' size='xs' className='font-mono'>
                          <AccountLabel account={mapped} density='compact' />
                        </Badge>
                      ) : (
                        <Badge variant='destructive' size='xs'>
                          Account not found
                        </Badge>
                      )}
                      <Badge
                        variant={gateway.status === 'active' ? 'outline' : 'secondary'}
                        size='xs'>
                        {gateway.status === 'active' ? 'Active' : 'Closed'}
                      </Badge>
                      <Badge variant='outline' size='xs'>
                        {PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[gateway.settlementSource]}
                      </Badge>
                    </span>
                  }
                />
              )
            }}
          />
        </div>
      )}
    </div>
  )
}
