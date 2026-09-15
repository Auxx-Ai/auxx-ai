// apps/web/src/components/accounting/ui/banking/payouts/payout-source-history.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { History } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { formatEvidenceDate } from './evidence-format'

/** Page immutable imports and retained failures without loading a payout's entire history. */
export function PayoutSourceHistory({ payoutId }: { payoutId: string }) {
  const query = api.payoutEvidence.history.useInfiniteQuery(
    { transferId: payoutId, limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const observations = query.data?.pages.flatMap((page) => page.items) ?? []

  // Each row starts open (its reason/rejections are the point of this list),
  // and collapsing one is tracked as an exception rather than the default —
  // so a fresh page of history never needs its own entry here to read as open.
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(new Set())
  const toggleOpen = (id: string) =>
    setClosedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  return (
    <Section
      title='Import history'
      icon={<History className='size-4' />}
      description='Each source page retains its original details. Current evidence completeness is shown above.'
      collapsible={false}>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load import history</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {!query.isPending && observations.length === 0 && !query.error ? (
        <EmptyState icon={History} title='No source pages have been imported' />
      ) : (
        <TreeRowList
          items={observations}
          loading={query.isPending}
          skeletonCount={3}
          getKey={(observation) => observation.id}
          renderRow={(observation) => (
            <TreeRow
              icon={<History className='size-4' />}
              title={formatEvidenceDate(observation.createdAt)}
              secondary={`${observation.entryCount} entries${
                observation.pageIndex !== null ? ` · Page ${observation.pageIndex + 1}` : ''
              }`}
              expandable
              isOpen={!closedIds.has(observation.id)}
              onToggleOpen={() => toggleOpen(observation.id)}>
              <div className='flex flex-col gap-2 pt-1 pb-2 ps-6 pe-2 text-sm'>
                {observation.reason && <p className='text-destructive'>{observation.reason}</p>}
                {observation.rejections.map((rejection) => (
                  <p key={rejection.index} className='text-destructive'>
                    Row {rejection.index + 1}: {rejection.reason}
                  </p>
                ))}
                <CollapsedJson title='Raw evidence' value={observation.rawEvidence} />
              </div>
            </TreeRow>
          )}
        />
      )}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more history
        </Button>
      )}
    </Section>
  )
}
