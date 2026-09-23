// apps/web/src/components/accounting/ui/banking/matches/provider-match-list.tsx

'use client'

import type { MatchState } from '@auxx/lib/accounting/provider-matches/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { ExternalLink, FileText, GitCompareArrows, Landmark, Receipt } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatMinor } from '../../ledger/format'
import { RecordChipLink } from '../payouts/record-chip-link'
import {
  canDismissProviderMatch,
  PROVIDER_MATCH_STATE_LABEL,
  PROVIDER_MATCH_STATE_VARIANT,
  providerMatchAcceptAction,
  providerMatchReasonCopy,
} from './provider-match-copy'

type MatchRow = RouterOutputs['providerMatch']['list']['rows'][number]

const TYPE_ICONS: Record<string, typeof Receipt> = { Payment: Receipt, Deposit: Landmark }

function emptyCopy(state: MatchState, provider: string): { title: string; description: string } {
  switch (state) {
    case 'suggested':
      return {
        title: 'No suggestions',
        description: `No transaction in ${provider} is waiting on a decision about a record of ours.`,
      }
    case 'pending':
      return {
        title: 'Nothing waiting',
        description: `No deposit in ${provider} is waiting for a payout of ours to arrive.`,
      }
    case 'unmatchable':
      return {
        title: 'Nothing needs a person',
        description: `Every transaction the matcher read from ${provider} was matched or suggested.`,
      }
    case 'matched':
      return {
        title: 'Nothing settled yet',
        description: `Transactions in ${provider} matched to records of ours appear here.`,
      }
  }
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <dt className='shrink-0 text-muted-foreground text-xs'>{label}</dt>
      <dd className='min-w-0 break-all text-right text-xs'>{children}</dd>
    </div>
  )
}

/** The provider's own transactions in one match state; the payout items' row design (`processor-activity.tsx`). */
export function ProviderMatchList({ state, canPost }: { state: MatchState; canPost: boolean }) {
  const query = api.providerMatch.list.useInfiniteQuery(
    { states: [state], limit: 50 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? []
  const provider = useAccountingProviderStatus().providerLabel ?? UNKNOWN_PROVIDER_LABEL

  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const invalidate = () =>
    Promise.all([utils.providerMatch.invalidate(), utils.payoutEvidence.invalidate()])
  const onError = (title: string) => (error: { message: string }) =>
    toastError({ title, description: error.message })

  const accept = api.providerMatch.accept.useMutation({
    onSuccess: invalidate,
    onError: onError('Error accepting the match'),
  })
  const dismiss = api.providerMatch.dismiss.useMutation({
    onSuccess: invalidate,
    onError: onError('Error dismissing the match'),
  })

  const onAccept = async (row: MatchRow) => {
    const action = providerMatchAcceptAction(row, provider)
    if (!action) return
    if (action.confirm) {
      const confirmed = await confirm({
        ...action.confirm,
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }
    accept.mutate({ entryId: row.id })
  }

  // Open by default: on this list the reason and the decision are the point of each row.
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(new Set())
  const toggleOpen = (id: string) =>
    setClosedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (!query.isPending && !query.error && rows.length === 0) {
    return <EmptyState icon={GitCompareArrows} {...emptyCopy(state, provider)} />
  }

  return (
    <>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load matches</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      <TreeRowList
        items={rows}
        loading={query.isPending}
        skeletonCount={4}
        className={`gap-px ${TREE_SECONDARY_NOTRUNCATE}`}
        getKey={(row) => row.id}
        renderRow={(row) => {
          const Icon = TYPE_ICONS[row.providerTxnType] ?? FileText
          const acceptAction = providerMatchAcceptAction(row, provider)
          const pendingForRow = (mutation: typeof accept | typeof dismiss) =>
            mutation.isPending && mutation.variables?.entryId === row.id
          return (
            <TreeRow
              icon={<Icon className='size-4' />}
              title={
                <span className='flex min-w-0 items-center gap-1.5'>
                  <span className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                    {row.txnDate}
                  </span>
                  <span className='truncate text-sm'>
                    {row.providerTxnType} {row.docNumber ?? row.providerTxnId}
                  </span>
                </span>
              }
              secondary={
                <span className='flex items-center gap-1.5'>
                  {row.customerName && <span className='text-xs'>{row.customerName}</span>}
                  {row.matchState && (
                    <Badge variant={PROVIDER_MATCH_STATE_VARIANT[row.matchState]} size='sm'>
                      {PROVIDER_MATCH_STATE_LABEL[row.matchState]}
                    </Badge>
                  )}
                </span>
              }
              actions={
                <span className='font-mono text-sm tabular-nums'>
                  {formatMinor(row.amountMinor, row.currency)}
                </span>
              }
              rowClassName='[&>div:first-child]:flex-wrap'
              expandable
              isOpen={!closedIds.has(row.id)}
              onToggleOpen={() => toggleOpen(row.id)}>
              <div className='flex flex-col gap-1.5 pt-1 pb-2 ps-6 pe-2'>
                <dl className='flex flex-col gap-1.5'>
                  <DetailRow label='Theirs'>
                    {row.providerTxnType} {row.docNumber ?? row.providerTxnId} ·{' '}
                    <span className='font-mono tabular-nums'>
                      {formatMinor(row.amountMinor, row.currency)}
                    </span>
                  </DetailRow>
                  {row.matched && (
                    <DetailRow label='Ours'>
                      <span className='inline-flex flex-wrap items-center justify-end gap-1'>
                        <OurSide row={row} />
                        {row.matched.date && (
                          <span className='font-mono tabular-nums'>{row.matched.date}</span>
                        )}
                        {row.matched.amountMinor !== null && (
                          <span className='font-mono tabular-nums'>
                            {formatMinor(row.matched.amountMinor, row.currency)}
                          </span>
                        )}
                      </span>
                    </DetailRow>
                  )}
                </dl>
                <p className='text-muted-foreground text-xs'>
                  {providerMatchReasonCopy(row, provider)}
                </p>
                <div className='flex flex-wrap items-center gap-2 pt-1'>
                  {canPost && acceptAction && (
                    <Button
                      size='sm'
                      variant='outline'
                      loading={pendingForRow(accept)}
                      disabled={dismiss.isPending}
                      onClick={() => void onAccept(row)}>
                      {acceptAction.label}
                    </Button>
                  )}
                  {canPost && canDismissProviderMatch(row.matchState) && (
                    <Button
                      size='sm'
                      variant='ghost'
                      loading={pendingForRow(dismiss)}
                      disabled={accept.isPending}
                      onClick={() => dismiss.mutate({ entryId: row.id })}>
                      Dismiss
                    </Button>
                  )}
                  {row.providerObjectUrl && (
                    <Button asChild size='sm' variant='ghost'>
                      <a href={row.providerObjectUrl} target='_blank' rel='noopener noreferrer'>
                        <ExternalLink />
                        Open in {provider}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </TreeRow>
          )
        }}
      />
      <InfiniteListTail
        key={state}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={query.fetchNextPage}
        loadingLabel='Loading more matches...'
      />
      <ConfirmDialog />
    </>
  )
}

/** Our record as a link where one resolves: the payout's drawer (else its record), the invoice or bill, or the one a payment settles. */
function OurSide({ row }: { row: MatchRow }) {
  const matched = row.matched
  if (!matched || !row.matchedId) return null
  if (row.matchedKind === 'payout') {
    if (matched.payoutEvidenceId) {
      return (
        <Link href={`/app/accounting/banking/payouts?payout=${matched.payoutEvidenceId}`}>
          <Badge variant='outline' size='xs' className='hover:underline'>
            {matched.label}
          </Badge>
        </Link>
      )
    }
    return (
      <RecordChipLink
        document={{ kind: 'payout', instanceId: row.matchedId, displayName: matched.label }}
      />
    )
  }
  if (row.matchedKind === 'invoice' || row.matchedKind === 'vendor_bill') {
    return (
      <RecordChipLink
        document={{ kind: row.matchedKind, instanceId: row.matchedId, displayName: matched.label }}
      />
    )
  }
  return (
    <>
      <span>{matched.label}</span>
      {matched.invoiceInstanceId && (
        <RecordChipLink
          document={{
            kind: 'invoice',
            instanceId: matched.invoiceInstanceId,
            displayName: 'Invoice',
          }}
        />
      )}
      {matched.vendorBillInstanceId && (
        <RecordChipLink
          document={{
            kind: 'vendor_bill',
            instanceId: matched.vendorBillInstanceId,
            displayName: 'Bill',
          }}
        />
      )}
    </>
  )
}
