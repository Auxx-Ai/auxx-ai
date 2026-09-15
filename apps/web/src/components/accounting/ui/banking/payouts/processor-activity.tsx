// apps/web/src/components/accounting/ui/banking/payouts/processor-activity.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { api } from '~/trpc/react'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'

/** Inspect processor entries, including unresolved references and the outgoing payout. */
export function ProcessorActivity({
  transferId,
  unassignedOnly,
}: {
  transferId?: string
  unassignedOnly?: boolean
}) {
  const query = api.payoutEvidence.entries.useInfiniteQuery(
    { transferId, unassignedOnly, limit: 50 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const entries = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load processor activity</AlertTitle>
          <AlertDescription>
            {query.error.message} Use Refresh evidence to try again.
          </AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton className='h-28 w-full' />
      ) : !query.error && entries.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {unassignedOnly
            ? 'No unassigned activity has been imported.'
            : 'No processor activity has been imported for this payout. Check evidence completeness before treating it as an empty payout.'}
        </p>
      ) : entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activity / source references</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className='text-right'>Gross</TableHead>
              <TableHead className='text-right'>Fee</TableHead>
              <TableHead className='text-right'>Net</TableHead>
              <TableHead>Payment match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className='font-medium'>{entry.externalId}</div>
                  <div className='text-xs text-muted-foreground'>
                    {entry.providerKey} · {entry.externalAccountId}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {entry.type.replaceAll('_', ' ')}
                  </div>
                  {entry.sourceTransactionId && (
                    <div className='text-xs text-muted-foreground'>
                      Transaction: {entry.sourceTransactionId}
                    </div>
                  )}
                  {entry.sourceOrderId && (
                    <div className='text-xs text-muted-foreground'>
                      Order: {entry.sourceOrderId}
                    </div>
                  )}
                  {!entry.payoutExternalId && (
                    <Badge variant='outline' size='sm'>
                      Unassigned
                    </Badge>
                  )}
                  {entry.isOutgoingTransfer && (
                    <Badge variant='outline' size='sm'>
                      Outgoing payout
                    </Badge>
                  )}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatEvidenceDate(entry.transactionDate)}
                </TableCell>
                {[entry.grossMinor, entry.feeMinor, entry.netMinor].map((amount, index) => (
                  <TableCell
                    key={['gross', 'fee', 'net'][index]}
                    className='whitespace-nowrap text-right font-mono tabular-nums'>
                    {formatEvidenceAmount(amount, entry.currency, entry.currencyExponent)}
                  </TableCell>
                ))}
                <TableCell>
                  <Badge variant={entry.matchState === 'matched' ? 'outline' : 'secondary'}>
                    {entry.isOutgoingTransfer ? 'Not applicable' : entry.matchState}
                  </Badge>
                  {entry.matchedMoneyTransactionId && (
                    <div className='mt-1 break-all text-xs text-muted-foreground'>
                      Payment: {entry.matchedMoneyTransactionId}
                    </div>
                  )}
                  {!entry.isOutgoingTransfer && entry.matchState === 'unmatched' && (
                    <p className='mt-1 max-w-64 text-xs text-muted-foreground'>
                      Import the related payment evidence, then refresh. An order reference alone
                      does not establish a payment match.
                    </p>
                  )}
                  {!entry.isOutgoingTransfer && entry.matchState === 'unsupported' && (
                    <p className='mt-1 max-w-64 text-xs text-muted-foreground'>
                      This activity needs a supported accounting classification before posting.
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more activity
        </Button>
      )}
    </>
  )
}
