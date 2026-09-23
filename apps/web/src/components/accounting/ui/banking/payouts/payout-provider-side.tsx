// apps/web/src/components/accounting/ui/banking/payouts/payout-provider-side.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import type { ReactNode } from 'react'
import { useProviderName } from '~/components/money/ui/provider-payment-notice'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatAccountingDate, formatMinor } from '../../ledger/format'

type ProviderSide = RouterOutputs['providerMatch']['forPayout']
type Deposit = NonNullable<ProviderSide['deposit']>
type Duplicate = ProviderSide['duplicates'][number]

const LINK_CLASS = 'text-foreground underline-offset-2 hover:underline'

/** `ExportBatch.state` in the words the drawer uses; a withdrawn batch is as good as none. */
function depositSentence(deposit: Deposit | null, provider: string): string {
  switch (deposit?.batchState) {
    case 'ready':
    case 'sending':
      return `Deposit queued for ${provider}.`
    case 'sent':
      return `Deposit sent to ${provider}.`
    case 'failed':
      return `Deposit failed to send to ${provider}.`
    default:
      return 'Deposit not built yet.'
  }
}

function clearedSentence(cleared: string | null, provider: string): string {
  if (cleared === 'R') return `Reconciled in ${provider}.`
  if (cleared === 'C') return `Cleared in ${provider}.`
  return `Not yet reconciled in ${provider}.`
}

function duplicateSentence(row: Duplicate, provider: string): string {
  if (row.matchState === 'matched') return `Waiting for them to delete it in ${provider}.`
  if (row.matchReason === 'ours_unsent')
    return 'Ours is not sent yet, but it carries the fee split theirs lacks, so theirs should go.'
  if (row.matchReason === 'duplicate_sent')
    return `Ours was already sent, so ${provider} now holds this payout twice.`
  return 'This may be the same payout as ours.'
}

function ProviderLink({ href, provider }: { href: string | null; provider: string }) {
  if (!href) return null
  return (
    <a href={href} target='_blank' rel='noreferrer' className={LINK_CLASS}>
      Open in {provider}
    </a>
  )
}

interface PayoutProviderSideProps {
  /** The `payout` record id; null before the record exists. */
  payoutId: string | null
  /** Whether the provider says the payout reached the bank. */
  deposited: boolean
  bookTimeZone: string
  /** What shows when no book is connected: the bank route's line. */
  fallback: ReactNode
}

/** The connected books' side of one payout: our Deposit, its cleared flag, and their duplicates. */
export function PayoutProviderSide({
  payoutId,
  deposited,
  bookTimeZone,
  fallback,
}: PayoutProviderSideProps) {
  const utils = api.useUtils()
  const provider = useProviderName()
  const canPost = useAccess().can('ledger.post')
  const query = api.providerMatch.forPayout.useQuery(
    { payoutId: payoutId ?? '' },
    { enabled: !!payoutId }
  )
  const invalidate = () =>
    Promise.all([
      utils.providerMatch.forPayout.invalidate(),
      utils.providerMatch.list.invalidate(),
      utils.providerMatch.counts.invalidate(),
    ])
  const accept = api.providerMatch.accept.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error accepting the match', description: error.message }),
  })
  const dismiss = api.providerMatch.dismiss.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error dismissing the match', description: error.message }),
  })

  if (!payoutId || query.error || (query.data && !query.data.connected)) return fallback
  if (!query.data) return null
  const { deposit, duplicates } = query.data

  return (
    <>
      {(deposit || deposited) && (
        <p className='text-muted-foreground text-xs'>
          {depositSentence(deposit, provider)}
          {deposit?.batchState === 'sent' && ` ${clearedSentence(deposit.cleared, provider)}`}
          {deposit?.providerObjectUrl && ' '}
          <ProviderLink href={deposit?.providerObjectUrl ?? null} provider={provider} />
        </p>
      )}
      {duplicates.map((row) => (
        <Alert key={row.id} variant='warning'>
          <AlertTitle>{provider} holds another deposit for this payout</AlertTitle>
          <AlertDescription className='flex flex-col items-start gap-2'>
            <span>
              {row.providerTxnType} {row.docNumber ?? row.providerTxnId} on{' '}
              {formatAccountingDate(row.txnDate, bookTimeZone)},{' '}
              {formatMinor(row.amountMinor, row.currency)}.{' '}
              <ProviderLink href={row.providerObjectUrl} provider={provider} />
            </span>
            <span>{duplicateSentence(row, provider)}</span>
            {canPost && row.matchState === 'suggested' && (
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  loading={accept.isPending && accept.variables?.entryId === row.id}
                  onClick={() => accept.mutate({ entryId: row.id })}>
                  Ask to delete theirs
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  loading={dismiss.isPending && dismiss.variables?.entryId === row.id}
                  onClick={() => dismiss.mutate({ entryId: row.id })}>
                  Dismiss
                </Button>
              </div>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </>
  )
}
