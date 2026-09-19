// apps/web/src/components/purchasing/vendor-bill/vendor-bill-link-card.tsx

'use client'

// The bill-side link review surface (plans/money/tasks/58 §6.5). It keeps the
// deterministic proposal separate from the write: a person accepts a proposed
// order line, picks a different one, codes a charge, or folds shipping.

import { FieldType } from '@auxx/database/enums'
import type {
  LineProposal,
  LineProposalCandidate,
} from '@auxx/lib/accounting/purchasing/bill-intake/client'
import { matchBill } from '@auxx/lib/accounting/purchasing/client'
import { isAutoLinkTier } from '@auxx/lib/accounting/purchasing/intake/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { ChevronDown, ChevronRight, Link2, Loader2, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { GlAccountPicker } from '~/components/accounting/ui/gl-account-picker'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { parseRecordId } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { IntakeTierBadge } from '../intake/ui/intake-tier-badge'
import { PurchaseOrderLinePicker } from '../purchase-order/purchase-order-line-picker'
import { usePurchaseOrderLines } from '../purchase-order/use-purchase-order-lines'
import { useVendorBillLines, type VendorBillLineValues } from './use-vendor-bill-lines'

const BILL_ORDER_ATTRIBUTES = [
  'vendor_bill_purchase_order',
  'vendor_bill_currency',
  'vendor_bill_shipping_total',
] as const

/** Review and apply deterministic proposals for unlinked bill lines. */
export function VendorBillLinkCard({ recordId }: DrawerTabProps) {
  const billRecordId = recordId as RecordId
  const { values: billValues } = useSystemValues(billRecordId, BILL_ORDER_ATTRIBUTES, {
    autoFetch: true,
  })
  const purchaseOrderRecordId = extractRelationshipRecordIds(
    billValues.vendor_bill_purchase_order
  )[0] as RecordId | undefined
  const currencyCode =
    typeof billValues.vendor_bill_currency === 'string' && billValues.vendor_bill_currency
      ? billValues.vendor_bill_currency
      : 'USD'
  const shippingTotal =
    typeof billValues.vendor_bill_shipping_total === 'number'
      ? billValues.vendor_bill_shipping_total
      : 0
  const { rows, ready, refresh } = useVendorBillLines(billRecordId)
  const readOnly = useRecordDrawerReadOnly(
    parseRecordId(billRecordId).entityDefinitionId,
    parseRecordId(billRecordId).entityInstanceId
  )
  const { canDeleteEntity } = useAccess()
  const query = api.purchasing.proposeBillLineLinks.useQuery(
    { billRecordId },
    { enabled: !!purchaseOrderRecordId && ready }
  )
  const link = api.purchasing.linkBillLines.useMutation()
  const fold = api.purchasing.foldBillLineIntoShipping.useMutation()
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyLine, setBusyLine] = useState<string | null>(null)
  const [pickedLine, setPickedLine] = useState<Record<string, RecordId | null>>({})
  const { saveFieldValue } = useSaveFieldValue()
  const { lines: orderLines } = usePurchaseOrderLines(purchaseOrderRecordId ?? null)
  const { values: orderValues } = useSystemValues(
    purchaseOrderRecordId ?? null,
    ['purchase_order_expected_at'],
    { autoFetch: true, enabled: !!purchaseOrderRecordId }
  )
  const expectedAtValue = orderValues.purchase_order_expected_at
  const expectedAt =
    typeof expectedAtValue === 'string' && expectedAtValue ? new Date(expectedAtValue) : null

  const unlinked = useMemo(() => {
    if (!query.data) return []
    const rowById = new Map(rows.map((row) => [row.lineRecordId, row]))
    return query.data.proposals
      .filter(
        (proposal) => !rowById.get(proposal.lineId as RecordId)?.values.purchaseOrderLineRecordId
      )
      .map((proposal) => ({ proposal, row: rowById.get(proposal.lineId as RecordId) }))
      .filter((item): item is { proposal: LineProposal; row: (typeof rows)[number] } => !!item.row)
  }, [query.data, rows])

  if (!purchaseOrderRecordId || !ready) return null
  if (query.isLoading && !query.data) {
    return <div className='px-3 py-2 text-muted-foreground text-sm'>Preparing line matches…</div>
  }
  if (query.error) {
    return (
      <div className='flex items-center justify-between gap-2 px-3 py-2 text-sm'>
        <span className='text-destructive'>Could not prepare line matches.</span>
        <Button variant='outline' size='xs' onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  if (!query.data || unlinked.length === 0) return null

  const accept = async (proposal: LineProposal, orderLineRecordId: RecordId) => {
    if (readOnly) return
    setBusyLine(proposal.lineId)
    try {
      await link.mutateAsync({
        billRecordId,
        links: [{ lineRecordId: proposal.lineId as RecordId, orderLineRecordId }],
      })
      await utils.purchasing.proposeBillLineLinks.invalidate({ billRecordId })
      setPickedLine((current) => ({ ...current, [proposal.lineId]: null }))
    } catch (error) {
      toastError({
        title: 'Could not link bill line',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBusyLine(null)
    }
  }

  const acceptAll = async () => {
    if (readOnly) return
    const links = unlinked.flatMap(({ proposal }) => {
      const candidate = proposal.candidates[0]
      return candidate && isAutoLinkTier(candidate.tier)
        ? [
            {
              lineRecordId: proposal.lineId as RecordId,
              orderLineRecordId: candidate.orderLineRecordId,
            },
          ]
        : []
    })
    if (links.length === 0) return
    setBusyLine('all')
    try {
      await link.mutateAsync({ billRecordId, links })
      await utils.purchasing.proposeBillLineLinks.invalidate({ billRecordId })
    } catch (error) {
      toastError({
        title: 'Could not link bill lines',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBusyLine(null)
    }
  }

  const foldShipping = async (lineRecordId: RecordId) => {
    if (readOnly) return
    const confirmed = await confirm({
      title: 'Fold this line into shipping?',
      description:
        'The printed line total will be moved to the bill shipping total and the line removed.',
      confirmText: 'Fold into shipping',
      cancelText: 'Cancel',
    })
    if (!confirmed) return
    setBusyLine(lineRecordId)
    try {
      await fold.mutateAsync({ billRecordId, lineRecordId })
      await utils.purchasing.proposeBillLineLinks.invalidate({ billRecordId })
      await refresh()
    } catch (error) {
      toastError({
        title: 'Could not fold bill line',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setBusyLine(null)
    }
  }

  return (
    <div id='vendor-bill-link-review' className='space-y-2 px-3'>
      <DrawerCardActions>
        <Button
          variant='ghost'
          size='xs'
          onClick={() => void query.refetch()}
          disabled={readOnly || query.isFetching}>
          {query.isFetching ? <Loader2 className='animate-spin' /> : <Link2 />}
          Match lines
        </Button>
        {unlinked.some(({ proposal }) =>
          isAutoLinkTier(proposal.candidates[0]?.tier ?? 'none')
        ) && (
          <Button
            variant='ghost'
            size='xs'
            onClick={() => void acceptAll()}
            disabled={readOnly || busyLine !== null}>
            Accept all
          </Button>
        )}
      </DrawerCardActions>
      {unlinked.map(({ proposal, row }) => {
        const candidate = proposal.candidates[0]
        const isOpen = expanded === proposal.lineId
        const selected = pickedLine[proposal.lineId] ?? null
        const canDeleteLine = canDeleteEntity(
          parseRecordId(proposal.lineId as RecordId).entityDefinitionId
        )
        return (
          <div key={proposal.lineId} className='rounded-lg border p-2'>
            <button
              type='button'
              className='flex w-full items-start gap-2 text-left'
              onClick={() => setExpanded(isOpen ? null : proposal.lineId)}>
              {isOpen ? (
                <ChevronDown className='mt-0.5 size-4 shrink-0' />
              ) : (
                <ChevronRight className='mt-0.5 size-4 shrink-0' />
              )}
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm'>
                  {row.values.description || 'Untitled line'}
                </span>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {row.values.quantityBilled ?? '—'} ×{' '}
                  {row.values.unitPrice === null
                    ? '—'
                    : formatCurrency(row.values.unitPrice, { currencyCode })}
                </span>
              </span>
              {candidate && <IntakeTierBadge tier={candidate.tier} vendorName={null} />}
            </button>
            {isOpen && (
              <ProposalBody
                purchaseOrderRecordId={purchaseOrderRecordId}
                candidate={candidate}
                line={row.values}
                selected={selected}
                readOnly={readOnly}
                currencyCode={currencyCode}
                shippingAvailable={shippingTotal === 0}
                orderLines={orderLines}
                expectedAt={expectedAt}
                onAccept={(orderLineId) => void accept(proposal, orderLineId)}
                onPick={(orderLineId) => {
                  setPickedLine((current) => ({ ...current, [proposal.lineId]: orderLineId }))
                }}
                onFold={() => void foldShipping(proposal.lineId as RecordId)}
                canDeleteLine={canDeleteLine}
                onCode={(accountId) =>
                  void saveFieldValue(
                    proposal.lineId as RecordId,
                    'vendor_bill_line_gl_account',
                    accountId,
                    FieldType.TEXT
                  )
                }
                busy={busyLine === proposal.lineId || busyLine === 'all'}
              />
            )}
          </div>
        )
      })}
      <ConfirmDialog />
    </div>
  )
}

function ProposalBody({
  purchaseOrderRecordId,
  candidate,
  line,
  selected,
  currencyCode,
  shippingAvailable,
  orderLines,
  expectedAt,
  readOnly,
  onAccept,
  onPick,
  onFold,
  onCode,
  canDeleteLine,
  busy,
}: {
  purchaseOrderRecordId: RecordId
  candidate?: LineProposalCandidate
  line: VendorBillLineValues
  selected: RecordId | null
  currencyCode: string
  shippingAvailable: boolean
  orderLines: ReturnType<typeof usePurchaseOrderLines>['lines']
  expectedAt: Date | null
  readOnly: boolean
  onAccept: (id: RecordId) => void
  onPick: (id: RecordId | null) => void
  onFold: () => void
  onCode: (id: string) => void
  canDeleteLine: boolean
  busy: boolean
}) {
  const selectedOrderLine = selected
    ? orderLines.find((orderLine) => orderLine.lineRecordId === selected)
    : undefined
  const suggestedOrderLine = candidate
    ? orderLines.find((orderLine) => orderLine.lineRecordId === candidate.orderLineRecordId)
    : undefined
  const activeOrderLine = selectedOrderLine ?? suggestedOrderLine
  const activeOrderLineRecordId = selected ?? candidate?.orderLineRecordId ?? null
  const activePreview = getMatchPreview(activeOrderLine, line, expectedAt)
  const isSelectedSuggestion = !!selected && selected === candidate?.orderLineRecordId
  const previewSummary = activePreview ? (
    <p className='text-muted-foreground'>
      This link will be{' '}
      <span className='font-medium'>{activePreview.outcome.replace('_', ' ')}</span>.
      {activePreview.variance !== 0 && (
        <span> Variance {formatCurrency(activePreview.variance, { currencyCode })}.</span>
      )}
    </p>
  ) : null

  return (
    <div className='mt-2 space-y-2 border-t pt-2 ps-6'>
      {candidate ? (
        <div className='space-y-1 text-xs'>
          <p className='font-medium'>
            {selected && !isSelectedSuggestion
              ? `Selected: ${activeOrderLine?.description || 'Purchase order line'}`
              : candidate.label}
          </p>
          {(!selected || isSelectedSuggestion) &&
            candidate.reasons.map((reason) => (
              <p key={reason} className='text-muted-foreground'>
                • {reason}
              </p>
            ))}
          {previewSummary}
          <Button
            size='xs'
            variant='outline'
            onClick={() => activeOrderLineRecordId && onAccept(activeOrderLineRecordId)}
            disabled={readOnly || busy}>
            <Link2 /> {selected && !isSelectedSuggestion ? 'Accept selected line' : 'Accept'}
          </Button>
        </div>
      ) : (
        <div className='space-y-1 text-xs'>
          <p className='text-muted-foreground'>
            {selected
              ? `Selected: ${activeOrderLine?.description || 'Purchase order line'}`
              : 'No order line was suggested.'}
          </p>
          {previewSummary}
          {selected && activeOrderLineRecordId && (
            <Button
              size='xs'
              variant='outline'
              onClick={() => onAccept(activeOrderLineRecordId)}
              disabled={readOnly || busy}>
              <Link2 /> Accept selected line
            </Button>
          )}
        </div>
      )}
      <PurchaseOrderLinePicker
        purchaseOrderRecordId={purchaseOrderRecordId}
        value={selected}
        onChange={onPick}
        currencyCode={currencyCode}
        disabled={readOnly || busy}
      />
      <div className='flex flex-wrap gap-1'>
        {shippingAvailable && canDeleteLine && (
          <Button size='xs' variant='ghost' onClick={onFold} disabled={readOnly || busy}>
            <Truck /> Fold into shipping
          </Button>
        )}
        <GlAccountPicker
          value={line.glAccount || null}
          onChange={(value) => {
            if (value) onCode(value)
          }}
          selectBy='id'
          disabled={readOnly || busy}
          placeholder='Code to account'
          triggerProps={{ size: 'xs' }}
        />
      </div>
    </div>
  )
}

function getMatchPreview(
  orderLine: ReturnType<typeof usePurchaseOrderLines>['lines'][number] | undefined,
  line: VendorBillLineValues,
  expectedAt: Date | null
) {
  if (!orderLine || line.unitPrice === null) return null
  const result = matchBill(
    [
      {
        quantityBilled: line.quantityBilled ?? 1,
        quantityReceived: orderLine.received,
        unitPriceBilled: line.unitPrice,
        unitPriceExpected: orderLine.expectedUnitPrice,
        expectedAt,
      },
    ],
    new Date(),
    undefined
  )
  return { outcome: result.outcome, variance: 'variance' in result ? result.variance : 0 }
}
