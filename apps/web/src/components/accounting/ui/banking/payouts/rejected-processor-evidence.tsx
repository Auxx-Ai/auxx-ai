// apps/web/src/components/accounting/ui/banking/payouts/rejected-processor-evidence.tsx
'use client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { CollapsedJson } from '@auxx/ui/components/collapsed-json'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { SourceAccountBadge } from '~/components/accounting/ui/source-account-badge'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
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
        <InfiniteListTail
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          fetchNextPage={query.fetchNextPage}
          loadingLabel='Loading more issues...'
        />
      </div>
    </Section>
  )
}

/**
 * The same list as a panel, opened from the topbar's count-gated button — the
 * tab it replaces was dead chrome in the healthy case (81 §5.4).
 */
export function RejectedProcessorEvidenceDrawer({
  open,
  onOpenChange,
  isDocked,
  width,
  onWidthChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isDocked: boolean
  width: number
  onWidthChange: (width: number) => void
}) {
  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={width}
      onWidthChange={onWidthChange}
      minWidth={380}
      maxWidth={800}
      title='Import issues'>
      <div className='flex min-h-0 flex-1 flex-col rounded-t-xl'>
        <DrawerHeader
          icon={<AlertTriangle className='size-5 text-muted-foreground' />}
          title='Import issues'
          onClose={() => onOpenChange(false)}
        />
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex flex-col'>{open && <RejectedProcessorEvidence />}</div>
        </ScrollArea>
      </div>
    </DockableDrawer>
  )
}
