// apps/web/src/components/evals/ui/eval-suite-history.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection } from '@auxx/ui/components/section'
import { Spinner } from '@auxx/ui/components/spinner'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { formatRelativeTime } from '@auxx/utils'
import { History } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { canShowSuiteDiff } from '../utils/loop-logic'
import { EvalDrillBar } from './eval-drill-bar'
import { EvalDraftBadge, EvalStatusDot } from './eval-status-pill'
import { EvalSuiteDiffCard } from './eval-suite-diff-card'

/**
 * Iteration history (phase 5D.5): suite runs for an agent/procedure, newest
 * first. The `pinned → draft(hash A) → draft(hash B) → pinned` chronology IS
 * the loop's audit trail — no extra persistence. Expanding a row reveals its
 * child runs and, when a terminal baseline exists, the verdict-diff card.
 */

interface EvalSuiteHistoryProps {
  agentId: string
  procedureId?: string | null
  onOpenRun: (runId: string) => void
}

export function EvalSuiteHistory({ agentId, procedureId, onOpenRun }: EvalSuiteHistoryProps) {
  const historyQuery = api.eval.listSuiteRuns.useInfiniteQuery(
    { agentId, procedureId: procedureId ?? undefined },
    { getNextPageParam: (last) => last.nextCursor }
  )

  const suiteRuns = historyQuery.data?.pages.flatMap((p) => p.suiteRuns) ?? []

  return (
    <>
      <EvalDrillBar title='Suite history' />
      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        <div className='flex flex-col p-2'>
          {historyQuery.isLoading ? (
            <div className='flex h-32 items-center justify-center'>
              <Spinner className='size-5 text-muted-foreground' />
            </div>
          ) : suiteRuns.length === 0 ? (
            <EmptySection
              icon={<History className='size-4' />}
              title='No suite runs yet'
              description='Run all simulations to start an iteration history.'
            />
          ) : (
            suiteRuns.map((suite) => (
              <SuiteHistoryRow key={suite.id} suite={suite} onOpenRun={onOpenRun} />
            ))
          )}
          {historyQuery.hasNextPage && (
            <Button
              variant='ghost'
              size='xs'
              className='mt-1 self-center text-muted-foreground'
              loading={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}>
              Load more
            </Button>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

type SuiteRunRow = {
  id: string
  status: string
  runMode: string
  draftContentHash: string | null
  baselineSuiteRunId: string | null
  requestedCount: number
  passedCount: number
  failedCount: number
  errorCount: number
  createdAt: Date
}

function SuiteHistoryRow({
  suite,
  onOpenRun,
}: {
  suite: SuiteRunRow
  onOpenRun: (runId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const childrenQuery = api.eval.listSuiteChildRuns.useQuery(
    { suiteRunId: suite.id },
    { enabled: isOpen }
  )

  const counts = [
    `${suite.passedCount} passed`,
    `${suite.failedCount} failed`,
    ...(suite.errorCount > 0 ? [`${suite.errorCount} errored`] : []),
  ].join(' · ')

  const showDiff = canShowSuiteDiff(suite, suite.baselineSuiteRunId)

  return (
    <TreeRow
      depth={0}
      rowClassName='hover:bg-primary-100'
      icon={<History className='size-4 text-muted-foreground/60' />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className='text-xs'>{formatRelativeTime(suite.createdAt, true)}</span>
          {suite.runMode === 'draft' && <EvalDraftBadge contentHash={suite.draftContentHash} />}
        </span>
      }
      secondary={<span className='text-xs text-muted-foreground'>{counts}</span>}
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((o) => !o)}>
      <div className='flex flex-col gap-1.5 py-1 pe-4 ps-7'>
        {showDiff && suite.baselineSuiteRunId && (
          <EvalSuiteDiffCard
            baselineSuiteRunId={suite.baselineSuiteRunId}
            candidateSuiteRunId={suite.id}
            onOpenRun={onOpenRun}
          />
        )}
        {childrenQuery.isLoading ? (
          <span className='text-xs text-muted-foreground'>Loading runs…</span>
        ) : (
          childrenQuery.data?.map((run) => (
            <button
              key={run.id}
              type='button'
              className='flex items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-primary-100'
              onClick={() => onOpenRun(run.id)}>
              <EvalStatusDot status={run.status} />
              <span className='flex-1 truncate'>{run.caseName || 'Deleted case'}</span>
              {run.runMode === 'draft' && <EvalDraftBadge />}
            </button>
          ))
        )}
      </div>
    </TreeRow>
  )
}
