// apps/web/src/components/money/ui/credit-memo/credit-memo-settlement-card.tsx
'use client'

// Credit memo drawer's "Settlement" card, registered as 'credit_memo:settlement'
// (plans/accounting/tasks/10-credit-memos.md §6.2). What happened to the credit
// after issue, in the three outcomes of §1: applied to an invoice, held on the
// contact (the balance), or refunded. Reads `creditMemo.settlement` (the
// `CreditMemoSettlement` shape from `money/credit-memos/client.ts`) for the four
// figures, the applications and the refund legs; owns the Apply / Refund footer
// actions and the per-row unapply.

import type { RecordId } from '@auxx/lib/resources/client'
import { toRecordId } from '@auxx/types/resource'
import { Badge, type Variant as BadgeVariant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { ArrowLeftRight, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { paymentMethodLabel } from '~/components/money/ui/invoice/payment-method-options'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { ApplyCreditDialog } from './apply-credit-dialog'
import { RefundCreditDialog } from './refund-credit-dialog'

/** A refund leg's status chip: the money is back, still moving, or did not move. */
function refundChip(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'succeeded') return { label: 'Refunded', variant: 'gray' }
  if (status === 'pending') return { label: 'Refund pending', variant: 'amber' }
  return { label: 'Refund failed', variant: 'red' }
}

export function CreditMemoSettlementCard({ recordId }: DrawerTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [applyOpen, setApplyOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const utils = api.useUtils()
  const settlementQuery = api.creditMemo.settlement.useQuery({ creditMemoRecordId: recordId })
  const settlement = settlementQuery.data

  const invalidate = () => {
    void utils.creditMemo.settlement.invalidate({ creditMemoRecordId: recordId })
  }

  const unapply = api.creditMemo.unapplyCredit.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error unapplying credit', description: error.message }),
  })

  const handleUnapply = async (applicationRecordId: RecordId) => {
    const confirmed = await confirm({
      title: 'Unapply this credit?',
      description: 'The invoice balance goes back up by this amount and the credit is held again.',
      confirmText: 'Unapply',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) unapply.mutate({ applicationRecordId })
  }

  if (settlementQuery.isLoading || !settlement) {
    return <EmptySection loading title='Loading settlement' />
  }

  const {
    status,
    contactInstanceId,
    totalMinor,
    amountAppliedMinor,
    amountRefundedMinor,
    balanceMinor,
    applications,
    refunds,
  } = settlement
  // Apply and refund are second steps on an ISSUED memo with credit left (§2.4).
  const canSettle = status === 'issued' && balanceMinor > 0
  const contactRecordId = contactInstanceId ? toRecordId('contact', contactInstanceId) : null
  const hasRows = applications.length > 0 || refunds.length > 0

  return (
    <div className='flex flex-col gap-2'>
      {canSettle && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setApplyOpen(true)}>
            <ArrowLeftRight />
            Apply to invoice
          </Button>
          <Button variant='ghost' size='xs' onClick={() => setRefundOpen(true)}>
            <RotateCcw />
            Refund
          </Button>
        </DrawerCardActions>
      )}

      <SettlementStrip
        currencyCode={currencyCode}
        cells={[
          { label: 'Total', value: totalMinor },
          { label: 'Applied', value: amountAppliedMinor },
          { label: 'Refunded', value: amountRefundedMinor },
          { label: 'Balance', value: balanceMinor, emphasis: true },
        ]}
      />

      {!hasRows && (
        <EmptySection
          orientation='horizontal'
          icon={<ArrowLeftRight className='size-4' />}
          title={
            status === 'draft'
              ? 'Issue the memo to apply or refund it'
              : 'Not applied or refunded yet'
          }
        />
      )}

      {applications.length > 0 && (
        <TreeRowList
          items={applications}
          getKey={(application) => application.applicationInstanceId}
          renderRow={(application) => (
            <TreeRow
              rowClassName='hover:bg-primary-100'
              icon={<ArrowLeftRight className='size-4' />}
              title={
                <RecordBadge
                  recordId={toRecordId('invoice', application.invoiceInstanceId)}
                  variant='link'
                  size='sm'
                  openInStack
                />
              }
              secondary={
                application.appliedAt ? (
                  <span className='tabular-nums'>
                    {format(new Date(application.appliedAt), 'MMM d, yyyy')}
                  </span>
                ) : undefined
              }
              actions={
                <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                  <span className='shrink-0 text-foreground text-sm tabular-nums'>
                    {formatCurrency(application.amountMinor, currencyCode)}
                  </span>
                  {status !== 'void' && (
                    <TreeRowButton
                      variant='destructive'
                      tooltipText='Unapply credit'
                      disabled={unapply.isPending}
                      onClick={() =>
                        void handleUnapply(
                          toRecordId('credit_memo_application', application.applicationInstanceId)
                        )
                      }>
                      <Undo2 />
                    </TreeRowButton>
                  )}
                </div>
              }
            />
          )}
        />
      )}

      {refunds.length > 0 && (
        <TreeRowList
          items={refunds}
          getKey={(refund) => refund.transactionId}
          renderRow={(refund) => {
            const chip = refundChip(refund.status)
            return (
              <TreeRow
                rowClassName='hover:bg-primary-100'
                icon={<RotateCcw className='size-4' />}
                title={
                  <span className='truncate text-sm'>
                    {refund.provider === 'stripe'
                      ? 'Card refund'
                      : paymentMethodLabel(refund.method ?? 'other')}
                  </span>
                }
                secondary={
                  <span className='tabular-nums'>
                    {format(new Date(refund.createdAt), 'MMM d, yyyy')}
                  </span>
                }
                actions={
                  <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                    {refund.reference && (
                      <span className='max-w-32 truncate'>{refund.reference}</span>
                    )}
                    <span className='shrink-0 text-foreground text-sm tabular-nums'>
                      {formatCurrency(refund.amountMinor, currencyCode)}
                    </span>
                    <Badge variant={chip.variant} size='sm' className='shrink-0'>
                      {chip.label}
                    </Badge>
                  </div>
                }
              />
            )
          }}
        />
      )}

      {contactRecordId && (
        <ApplyCreditDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          creditMemoRecordId={recordId}
          contactRecordId={contactRecordId}
          balance={balanceMinor}
          currencyCode={currencyCode}
          onApplied={invalidate}
        />
      )}

      <RefundCreditDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        creditMemoRecordId={recordId}
        balance={balanceMinor}
        currencyCode={currencyCode}
        onRefunded={invalidate}
      />

      <ConfirmDialog />
    </div>
  )
}

/**
 * The four settlement figures in one row. Inline rather than
 * `PurchasingSummaryStrip` because `money` must not depend on `purchasing`
 * (the line builder's match-key editor is a render prop for the same reason).
 */
function SettlementStrip({
  cells,
  currencyCode,
}: {
  cells: Array<{ label: string; value: number; emphasis?: boolean }>
  currencyCode: string
}) {
  return (
    <div className='grid grid-cols-2 gap-2 rounded-xl border bg-primary-100 p-3 text-sm sm:grid-cols-4'>
      {cells.map((cell) => (
        <div key={cell.label} className='min-w-0'>
          <div className='text-xs text-muted-foreground'>{cell.label}</div>
          <div
            className={cn(
              'truncate tabular-nums',
              cell.emphasis ? 'font-medium' : undefined,
              cell.value === 0 && !cell.emphasis ? 'text-muted-foreground' : undefined
            )}>
            {formatCurrency(cell.value, currencyCode)}
          </div>
        </div>
      ))}
    </div>
  )
}
