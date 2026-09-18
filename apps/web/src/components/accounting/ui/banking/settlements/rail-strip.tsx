// apps/web/src/components/accounting/ui/banking/settlements/rail-strip.tsx

'use client'

// The per-rail strip on Banking > Payouts (brief 27 §8.2), one row per rail
// with a clearing account.
//
// 🛑 Every row names the ACCOUNT, never only the rail (26 §9.1). Nothing stamps
// a gateway onto a posting line, so the figure is what the account holds, and
// two rails on one account carry the same figure with a "shared with" note
// rather than two per-rail numbers that would sum to double.
//
// 🛑 The column is "Clearing balance", never "unsettled" (27 §10.3). Until
// brief 29 moves the clearing debit to the payment date the balance is a net
// of two queues - shipped-not-settled less settled-not-shipped - and a person
// must not read it as what the processor holds.

import {
  PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS,
  type PaymentGatewaySettlementSourceValue,
} from '@auxx/lib/accounting/rails/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { FileUp, Landmark } from 'lucide-react'
import type { ReactNode } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import { AccountLabel } from '../../account-label'
import { EMPTY_CELL, formatMinor } from '../../ledger/format'

type RailStripRow = RouterOutputs['money']['payout']['rails'][number]

interface RailStripProps {
  currencyCode: string
}

/**
 * How a rail's clearing account is credited back, in two words.
 *
 * `manual` is the review queue: a deposit coded "Settlement of <rail>" by hand
 * or by rule (27 §8.1). Anything else is a source that reads the provider.
 * Fails closed: an unknown source claims nothing rather than "By hand".
 */
function relievedBy(source: PaymentGatewaySettlementSourceValue): string {
  switch (source) {
    case 'manual':
      return 'Review queue'
    case 'stripe':
    case 'shopify_payments':
      return `${PAYMENT_GATEWAY_SETTLEMENT_SOURCE_LABELS[source]} sync`
    default:
      return EMPTY_CELL
  }
}

/** A captioned cell in the trailing cluster. The caption is the column label. */
function Cell({
  caption,
  children,
  className,
}: {
  caption: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-end gap-0.5', className)}>
      <span className='text-[10px] text-muted-foreground uppercase tracking-wide'>{caption}</span>
      <span className='text-sm'>{children}</span>
    </div>
  )
}

export function RailStrip({ currencyCode }: RailStripProps) {
  const railsQuery = api.money.payout.rails.useQuery()
  const rails = railsQuery.data ?? []

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-medium text-sm'>Rails</h3>
        {/* Present and disabled, never absent: the CSV source is unit 3 of
            brief 27 and the button is where §9 says it lives. A disabled
            button swallows pointer events, so the tooltip hangs on a span. */}
        <SimpleTooltip content='CSV import lands with unit 3'>
          <span tabIndex={0} className='inline-flex rounded-md outline-none'>
            <Button variant='outline' size='sm' disabled>
              <FileUp />
              Import statement
            </Button>
          </span>
        </SimpleTooltip>
      </div>

      {railsQuery.isPending ? (
        <TreeRowList
          items={[]}
          getKey={() => ''}
          renderRow={() => null}
          loading
          skeletonCount={2}
        />
      ) : rails.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          No rail names a clearing account yet. Add one under Accounting &gt; Settings &gt; Payment
          gateways, and its deposits can be coded as settlements from the review queue.
        </p>
      ) : (
        <TreeRowList
          items={rails}
          getKey={(rail) => rail.paymentGatewayId}
          renderRow={(rail: RailStripRow) => (
            <TreeRow
              icon={<Landmark />}
              title={
                <span className='flex items-center gap-2'>
                  {rail.name}
                  {rail.status === 'closed' && (
                    <Badge variant='outline' size='xs'>
                      closed
                    </Badge>
                  )}
                </span>
              }
              secondary={<AccountLabel glAccountId={rail.clearingGlAccountId} />}
              secondaryFill
              trailing={
                <div className='flex flex-wrap items-center justify-end gap-x-5 gap-y-1'>
                  <Cell caption='Clearing balance' className='min-w-28'>
                    <span className='font-mono tabular-nums'>
                      {formatMinor(rail.balanceMinor, currencyCode)}
                    </span>
                    {rail.sharedWith.length > 0 && (
                      <span className='block text-[10px] text-muted-foreground'>
                        account shared with {rail.sharedWith.join(', ')}
                      </span>
                    )}
                  </Cell>
                  <Cell caption='Last settled' className='min-w-24'>
                    <span className='tabular-nums'>{rail.lastSettledAt ?? EMPTY_CELL}</span>
                  </Cell>
                  <Cell caption='Last fee booked' className='min-w-24'>
                    {rail.feeTreatment === 'netted' ? (
                      <span className='text-muted-foreground'>with each payout</span>
                    ) : rail.feeAccountShared ? (
                      <span className='text-muted-foreground'>shared fee account</span>
                    ) : (
                      <span className='tabular-nums'>{rail.lastFeeBookedAt ?? EMPTY_CELL}</span>
                    )}
                  </Cell>
                  <Cell caption='Relieved by' className='min-w-24'>
                    <Badge variant='secondary' size='sm'>
                      {relievedBy(rail.settlementSource)}
                    </Badge>
                  </Cell>
                </div>
              }
            />
          )}
        />
      )}
    </div>
  )
}
