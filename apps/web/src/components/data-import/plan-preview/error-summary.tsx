// apps/web/src/components/data-import/plan-preview/error-summary.tsx

'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { AlertTriangle, Info } from 'lucide-react'
import { api } from '~/trpc/react'
import { SummaryTreeRow } from './summary-tree-row'

const PREVIEW_LIMIT = 5

interface RowIssuesProps {
  icon: React.ReactNode
  title: string
  description: string
  issues: Array<{ rowIndex: number; message: string }>
}

/** A summary row whose children are the sampled issues, each with its row number. */
function RowIssues({ icon, title, description, issues }: RowIssuesProps) {
  return (
    <SummaryTreeRow icon={icon} title={title} description={description}>
      {issues.length > 0 &&
        issues.map((issue, i) => (
          <TreeRow
            key={`${issue.rowIndex}-${i}`}
            depth={1}
            title={issue.message}
            actions={
              <span className='shrink-0 pe-1 text-xs text-muted-foreground tabular-nums'>
                Row {issue.rowIndex + 1}
              </span>
            }
          />
        ))}
    </SummaryTreeRow>
  )
}

interface ErrorSummaryProps {
  errorCount: number
  planId: string
}

/** Summary of rows with errors. */
export function ErrorSummary({ errorCount, planId }: ErrorSummaryProps) {
  const { data: errors } = api.dataImport.getPlanErrors.useQuery(
    { planId, limit: PREVIEW_LIMIT },
    { enabled: errorCount > 0 }
  )

  return (
    <RowIssues
      icon={<AlertTriangle className='size-4 text-destructive' />}
      title={`${errorCount.toLocaleString()} ${errorCount === 1 ? 'row has' : 'rows have'} errors`}
      description='These rows will be skipped.'
      issues={(errors ?? []).map((e) => ({ rowIndex: e.rowIndex, message: e.error }))}
    />
  )
}

interface WarningSummaryProps {
  planId: string
}

/**
 * Summary of rows that import with non-fatal warnings (invalid values dropped
 * from a multi-value cell, values already owned by another record).
 */
export function WarningSummary({ planId }: WarningSummaryProps) {
  const { data } = api.dataImport.getPlanWarnings.useQuery({ planId, limit: PREVIEW_LIMIT })

  if (!data || data.total === 0) return null

  return (
    <RowIssues
      icon={<Info className='size-4 text-info' />}
      title={`${data.total.toLocaleString()} ${data.total === 1 ? 'row has' : 'rows have'} warnings`}
      description='These rows still import, but some values were skipped.'
      issues={data.warnings.map((w) => ({ rowIndex: w.rowIndex, message: w.warning }))}
    />
  )
}
