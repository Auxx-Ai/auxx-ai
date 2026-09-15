// apps/web/src/components/accounting/ui/banking/payouts/rejected-processor-evidence.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { TreeRowSkeleton } from '@auxx/ui/components/tree-row'
import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
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
        <div className='flex flex-col'>
          {Array.from({ length: 3 }).map((_, i) => (
            <TreeRowSkeleton key={i} />
          ))}
        </div>
      ) : observations.length === 0 && !query.error ? (
        <EmptyState icon={ShieldCheck} title='No rejected source rows' />
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
          <div className='mt-2'>
            <CollapsedJson title='Source details' value={observation.rawEvidence} />
          </div>
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
