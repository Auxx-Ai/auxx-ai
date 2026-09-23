// apps/web/src/components/money/ui/provider-payment-notice.tsx
'use client'

import type { ProviderMatchRow } from '@auxx/lib/accounting/provider-matches/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { format, parseISO } from 'date-fns'
import { ExternalLink, Landmark } from 'lucide-react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'

/** The document a provider payment is pinned on: ours receives it, or ours pays it. */
export type ProviderPaymentDocumentKind = 'invoice' | 'vendor_bill'

type ProviderPayment = ProviderMatchRow & { providerObjectUrl: string | null }

interface DocumentCopy {
  noun: string
  /** What we call our own movement on this document. */
  ours: string
}

const DOCUMENT_COPY: Record<ProviderPaymentDocumentKind, DocumentCopy> = {
  invoice: { noun: 'invoice', ours: 'receipt' },
  vendor_bill: { noun: 'bill', ours: 'payment' },
}

/** A settled match whose movement is the document's payment: marked on the payment row instead. */
function isRecordedFromProvider(row: ProviderPayment): boolean {
  return (
    row.matchState === 'matched' &&
    row.matchedKind === 'money_transaction' &&
    (row.matchReason === 'adopted' || row.matchReason === 'ours_unsent')
  )
}

/** The provider payments naming one invoice or vendor bill (brief 102 M5); empty without `ledger.view`. */
export function useProviderPayments(kind: ProviderPaymentDocumentKind, recordId: RecordId) {
  const { can } = useAccess()
  const { entityInstanceId } = parseRecordId(recordId)
  const enabled = can('ledger.view')
  // Both hooks always run; only the one for this kind is enabled.
  const invoice = api.providerMatch.forInvoice.useQuery(
    { invoiceInstanceId: entityInstanceId },
    { enabled: enabled && kind === 'invoice' }
  )
  const bill = api.providerMatch.forVendorBill.useQuery(
    { vendorBillInstanceId: entityInstanceId },
    { enabled: enabled && kind === 'vendor_bill' }
  )
  const rows = (kind === 'invoice' ? invoice.data : bill.data) ?? []
  return {
    notices: rows.filter((row) => !isRecordedFromProvider(row)),
    recordedMovementIds: new Set(
      rows.filter(isRecordedFromProvider).flatMap((row) => (row.matchedId ? [row.matchedId] : []))
    ),
  }
}

/** The provider label with its fallback, capitalized to open a sentence. */
export function useProviderName(): string {
  const label = useAccountingProviderStatus().providerLabel ?? UNKNOWN_PROVIDER_LABEL
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function reasonSentence(row: ProviderPayment, copy: DocumentCopy, provider: string): string {
  if (row.matchState === 'matched') {
    if (row.matchReason === 'pays_bill') return `Waiting for them to pay the bill in ${provider}.`
    return 'Both books hold this payment; a work item asks for their copy to be deleted.'
  }
  if (row.matchState === 'unmatchable') {
    if (row.matchReason !== 'ambiguous') {
      return `It is more than this ${copy.noun}'s balance, so it was not recorded here. Resolve it by hand.`
    }
    return copy.noun === 'bill'
      ? 'It pays several bills, or several of our payments could be it, so it was not matched. Resolve it by hand.'
      : 'Several of our receipts could be this payment, so it was not matched. Resolve it by hand.'
  }
  if (row.matchReason === 'ours_unsent') {
    return `We recorded this ${copy.ours} too and have not sent it yet. Accept keeps theirs and reverses ours.`
  }
  if (row.matchReason === 'duplicate_sent') {
    return `Our ${copy.ours} was already sent, so both books hold it. Accept opens a work item to delete theirs.`
  }
  if (row.matchReason === 'pays_bill') {
    return `It pays this bill's open balance, but the bill is still open in ${provider}. Accept asks for it to be paid there; ours follows on the next sync.`
  }
  return `It looks like a ${copy.ours} we recorded.`
}

interface ProviderPaymentNoticeProps {
  kind: ProviderPaymentDocumentKind
  recordId: RecordId
  className?: string
}

/** One line per provider payment naming the document that still needs a person; nothing when none do. */
export function ProviderPaymentNotice({ kind, recordId, className }: ProviderPaymentNoticeProps) {
  const { can } = useAccess()
  const providerName = useProviderName()
  const { notices } = useProviderPayments(kind, recordId)
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const copy = DOCUMENT_COPY[kind]

  const refresh = () => {
    void utils.providerMatch.list.invalidate()
    void utils.providerMatch.counts.invalidate()
    if (kind === 'invoice') {
      void utils.providerMatch.forInvoice.invalidate()
      void utils.money.listPayments.invalidate({ invoiceRecordId: recordId })
    } else {
      void utils.providerMatch.forVendorBill.invalidate()
      void utils.money.billPayments.invalidate({ vendorBillRecordId: recordId })
    }
  }
  const accept = api.providerMatch.accept.useMutation({
    onSuccess: refresh,
    onError: (error) => toastError({ title: 'Error accepting match', description: error.message }),
  })
  const dismiss = api.providerMatch.dismiss.useMutation({
    onSuccess: refresh,
    onError: (error) => toastError({ title: 'Error dismissing match', description: error.message }),
  })

  if (notices.length === 0) return null
  const canPost = can('ledger.post')

  const handleAccept = async (row: ProviderPayment) => {
    if (row.matchReason === 'ours_unsent') {
      const confirmed = await confirm({
        title: `Keep ${providerName}'s payment?`,
        description: `Our ${copy.ours} stays on the ${copy.noun}, and its posting is reversed.`,
        confirmText: 'Accept',
        cancelText: 'Cancel',
      })
      if (!confirmed) return
    }
    accept.mutate({ entryId: row.id })
  }

  return (
    <div className={className ?? 'flex flex-col gap-2'}>
      {notices.map((row) => {
        const document = [row.providerTxnType, row.docNumber].filter(Boolean).join(' ')
        const date = format(parseISO(row.txnDate), 'MMM d, yyyy')
        const busy =
          (accept.isPending && accept.variables?.entryId === row.id) ||
          (dismiss.isPending && dismiss.variables?.entryId === row.id)
        return (
          <Alert key={row.id} variant={row.matchState === 'matched' ? 'neutral' : 'warning'}>
            <Landmark />
            <AlertTitle className='leading-snug'>
              {providerName} holds a {formatCurrency(row.amountMinor, row.currency)} payment for
              this {copy.noun} ({document}, {date})
            </AlertTitle>
            <AlertDescription>{reasonSentence(row, copy, providerName)}</AlertDescription>
            <div className='mt-1.5 flex flex-wrap items-center gap-2'>
              {row.providerObjectUrl && (
                <Button variant='outline' size='xs' asChild>
                  <a href={row.providerObjectUrl} target='_blank' rel='noopener noreferrer'>
                    <ExternalLink />
                    Open in {providerName}
                  </a>
                </Button>
              )}
              {canPost && row.matchState === 'suggested' && (
                <Button
                  variant='outline'
                  size='xs'
                  loading={accept.isPending && accept.variables?.entryId === row.id}
                  loadingText='Accepting...'
                  disabled={busy}
                  onClick={() => handleAccept(row)}>
                  {row.matchReason === 'pays_bill' ? 'Ask to pay the bill there' : 'Accept'}
                </Button>
              )}
              {canPost && row.matchState !== 'matched' && (
                <Button
                  variant='ghost'
                  size='xs'
                  loading={dismiss.isPending && dismiss.variables?.entryId === row.id}
                  loadingText='Dismissing...'
                  disabled={busy}
                  onClick={() => dismiss.mutate({ entryId: row.id })}>
                  Dismiss
                </Button>
              )}
            </div>
          </Alert>
        )
      })}
      <ConfirmDialog />
    </div>
  )
}
