// apps/web/src/components/accounting/ui/banking/payouts/payout-source-history.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { formatEvidenceDate } from './evidence-format'

/** Page immutable imports and retained failures without loading a payout's entire history. */
export function PayoutSourceHistory({ payoutId }: { payoutId: string }) {
  const query = api.payoutEvidence.history.useInfiniteQuery(
    { transferId: payoutId, limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const observations = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <SettingsSection
      title='Import history'
      description='Each source page retains its original details. Current evidence completeness is shown above.'>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load import history</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton className='h-24 w-full' />
      ) : observations.length === 0 && !query.error ? (
        <p className='text-muted-foreground text-sm'>No source pages have been imported.</p>
      ) : null}
      {observations.map((observation) => (
        <details key={observation.id} className='border-b pb-3 text-sm'>
          <summary className='cursor-pointer font-medium'>
            {formatEvidenceDate(observation.createdAt)} · {observation.entryCount} entries
            {observation.pageIndex !== null ? ` · Page ${observation.pageIndex + 1}` : ''}
          </summary>
          {observation.reason && <p className='mt-2 text-destructive'>{observation.reason}</p>}
          {observation.rejections.map((rejection) => (
            <p key={rejection.index} className='mt-2 text-destructive'>
              Row {rejection.index + 1}: {rejection.reason}
            </p>
          ))}
          <pre className='mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs'>
            {JSON.stringify(observation.rawEvidence, null, 2)}
          </pre>
        </details>
      ))}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more history
        </Button>
      )}
    </SettingsSection>
  )
}
