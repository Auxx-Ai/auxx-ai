// apps/web/src/components/data-import/plan-preview/import-plan-summary.tsx

'use client'

import { StatCard } from '@auxx/ui/components/stat-card'
import { Ban, Plus, RefreshCw, Rows3 } from 'lucide-react'
import type { ImportPlan } from '../types'
import { ErrorSummary } from './error-summary'

interface ImportPlanSummaryProps {
  plan?: ImportPlan
  loading?: boolean
}

/**
 * Summary of what the import will do.
 */
export function ImportPlanSummary({ plan, loading = false }: ImportPlanSummaryProps) {
  const estimates = plan?.estimates

  return (
    <div className='flex flex-col space-y-6'>
      {/* Overview stats */}
      <div className='grid grid-cols-4 border-b'>
        <StatCard
          title='Total Rows'
          icon={<Rows3 className='size-4' />}
          body={estimates?.totalRows.toLocaleString() ?? 0}
          description='Rows in your file'
          color='text-fuchsia-500'
          first
          loading={loading}
        />
        <StatCard
          title='Will Create'
          icon={<Plus className='size-4' />}
          body={estimates?.toCreate.toLocaleString() ?? 0}
          description='New records'
          color='text-good-500'
          loading={loading}
        />
        <StatCard
          title='Will Update'
          icon={<RefreshCw className='size-4' />}
          body={estimates?.toUpdate.toLocaleString() ?? 0}
          description='Existing records'
          color='text-info'
          loading={loading}
        />
        <StatCard
          title='Will Skip'
          icon={<Ban className='size-4' />}
          body={estimates?.toSkip.toLocaleString() ?? 0}
          description='Duplicates or errors'
          color='text-muted-foreground'
          loading={loading}
        />
      </div>

      {/* Errors */}
      {!loading && estimates && estimates.withErrors > 0 && plan && (
        <ErrorSummary errorCount={estimates.withErrors} planId={plan.id} />
      )}
    </div>
  )
}
