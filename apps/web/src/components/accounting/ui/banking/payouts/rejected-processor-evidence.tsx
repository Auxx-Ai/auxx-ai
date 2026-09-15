// apps/web/src/components/accounting/ui/banking/payouts/rejected-processor-evidence.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { Section } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { SourceAccountBadge } from '~/components/accounting/ui/source-account-badge'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { formatEvidenceDate } from './evidence-format'

/** Keep rejected source evidence inspectable without displaying fabricated money amounts. */
export function RejectedProcessorEvidence() {
  const query = api.payoutEvidence.rejected.useInfiniteQuery(
    { limit: 25 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const observations = query.data?.pages.flatMap((page) => page.items) ?? []

  // Each row starts open (its rejection reason is the point of this list), and
  // collapsing one is tracked as an exception rather than the default — so a
  // fresh page of issues never needs its own entry here to read as open. Same
  // shape, and same reason, as `payout-source-history.tsx`.
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
      title='Import issues'
      icon={<AlertTriangle className='size-4' />}
      description='Review source rows that could not become payout or processor activity records.'>
      {/* `TREE_SECONDARY_NOTRUNCATE`: the `secondary` slot carries a
          `SourceAccountBadge`, and the slot clips pill shapes by default. */}
      <div className={cn('flex flex-col gap-2', TREE_SECONDARY_NOTRUNCATE)}>
        {query.error && (
          <Alert variant='destructive'>
            <AlertTitle>Could not load import issues</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        )}
        {!query.isPending && observations.length === 0 && !query.error ? (
          <EmptyState icon={ShieldCheck} title='No rejected source rows' />
        ) : (
          <TreeRowList
            items={observations}
            loading={query.isPending}
            skeletonCount={3}
            getKey={(observation) => observation.observationId}
            renderRow={(observation) => (
              <TreeRow
                icon={<AlertTriangle className='size-4' />}
                title={observation.externalId}
                secondary={
                  <span className='flex items-center gap-1.5'>
                    <SourceAccountBadge
                      providerKey={observation.providerKey}
                      externalAccountId={observation.externalAccountId}
                      environment={observation.environment}
                      size='sm'
                    />
                    {formatEvidenceDate(observation.observedAt)}
                  </span>
                }
                expandable
                isOpen={!closedIds.has(observation.observationId)}
                onToggleOpen={() => toggleOpen(observation.observationId)}>
                <div className='flex flex-col gap-2 pt-1 pb-2 ps-6 pe-2 text-sm'>
                  <p className='text-destructive'>{observation.reason}</p>
                  <p className='text-muted-foreground'>
                    Correct the source evidence and import it again.
                  </p>
                  <CollapsedJson title='Source details' value={observation.rawEvidence} />
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
            Load more issues
          </Button>
        )}
      </div>
    </Section>
  )
}
