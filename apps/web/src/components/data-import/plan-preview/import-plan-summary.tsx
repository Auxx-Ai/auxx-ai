// apps/web/src/components/data-import/plan-preview/import-plan-summary.tsx

'use client'

import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { Ban, Plus, RefreshCw, Rows3, SearchX } from 'lucide-react'
import type { ImportPlan } from '../types'
import { ErrorSummary, WarningSummary } from './error-summary'
import { RelationCreateSummary } from './relation-create-summary'
import { SelectCreateSummary } from './select-create-summary'

interface ImportPlanSummaryProps {
  plan?: ImportPlan
  /** Job the plan belongs to. Required to surface the relation auto-create count. */
  jobId?: string
  loading?: boolean
}

/**
 * Summary of what the import will do.
 *
 * FIVE numbers, because a row lands in exactly one of four strategy buckets
 * and `withErrors` cuts across them. `Will Skip` and `Unmatched` are different
 * outcomes: skip means the row carries an ERROR, unmatched means the row is
 * fine but update-only mode found no record to update. A four-card summary that
 * folds the second into the first reports "0 skipped" while silently importing
 * nothing.
 */
export function ImportPlanSummary({ plan, jobId, loading = false }: ImportPlanSummaryProps) {
  const estimates = plan?.estimates

  const cards: StatCardData[] = [
    {
      title: 'Total Rows',
      icon: <Rows3 className='size-4' />,
      body: estimates?.totalRows.toLocaleString() ?? 0,
      description: 'Rows in your file',
      color: 'text-fuchsia-500',
    },
    {
      title: 'Will Create',
      icon: <Plus className='size-4' />,
      body: estimates?.toCreate.toLocaleString() ?? 0,
      description: 'New records',
      color: 'text-good-500',
    },
    {
      title: 'Will Update',
      icon: <RefreshCw className='size-4' />,
      body: estimates?.toUpdate.toLocaleString() ?? 0,
      description: 'Existing records',
      color: 'text-info',
    },
    {
      title: 'Unmatched',
      icon: <SearchX className='size-4' />,
      body: estimates?.toUnmatched.toLocaleString() ?? 0,
      description: 'No record to update',
      color: 'text-muted-foreground',
    },
    {
      title: 'Will Skip',
      icon: <Ban className='size-4' />,
      body: estimates?.toSkip.toLocaleString() ?? 0,
      description: 'Rows with errors',
      color: 'text-amber-500',
    },
  ]

  return (
    <div className='flex flex-col space-y-6'>
      {/* Overview stats */}
      <StatCards cards={cards} loading={loading} columns={{ md: 'md:grid-cols-5' }} />

      {/* What auto-create will mint, shown BEFORE execution, on purpose */}
      {!loading && jobId && <RelationCreateSummary jobId={jobId} />}

      {/* …and the OPTIONS a `select:create` column will append, named, for the
          same reason: a typo becomes a permanent option on the field. */}
      {!loading && jobId && <SelectCreateSummary jobId={jobId} />}

      {/* Errors */}
      {!loading && estimates && estimates.withErrors > 0 && plan && (
        <ErrorSummary errorCount={estimates.withErrors} planId={plan.id} />
      )}

      {/* Warnings (rows that still import, but with skipped values) */}
      {!loading && plan && <WarningSummary planId={plan.id} />}
    </div>
  )
}
