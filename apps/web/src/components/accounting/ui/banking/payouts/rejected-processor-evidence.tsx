// apps/web/src/components/accounting/ui/banking/payouts/rejected-processor-evidence.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { formatEvidenceDate } from './evidence-format'

/** Keep rejected source evidence inspectable without displaying fabricated money amounts. */
export function RejectedProcessorEvidence() {
  const query = api.payoutEvidence.rejected.useInfiniteQuery(
    { limit: 25 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const observations = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <SettingsSection
      title='Import issues'
      description='Review source rows that could not become payout or processor activity records.'>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load import issues</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton className='h-24 w-full' />
      ) : observations.length === 0 && !query.error ? (
        <p className='text-muted-foreground text-sm'>No rejected source rows.</p>
      ) : null}
      {observations.map((observation) => (
        <div key={observation.observationId} className='border-b pb-3 text-sm'>
          <p className='font-medium'>{observation.externalId}</p>
          <p className='text-muted-foreground text-xs'>
            {observation.providerKey} · {observation.externalAccountId} ·{' '}
            {formatEvidenceDate(observation.observedAt)}
          </p>
          <p className='mt-2 text-destructive'>{observation.reason}</p>
          <p className='mt-2 text-muted-foreground'>
            Correct the source evidence and import it again.
          </p>
          <details className='mt-2'>
            <summary className='cursor-pointer'>Source details</summary>
            <pre className='mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs'>
              {JSON.stringify(observation.rawEvidence, null, 2)}
            </pre>
          </details>
        </div>
      ))}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more issues
        </Button>
      )}
    </SettingsSection>
  )
}
