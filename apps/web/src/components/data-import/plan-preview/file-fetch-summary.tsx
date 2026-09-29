// apps/web/src/components/data-import/plan-preview/file-fetch-summary.tsx

'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { ImageDown } from 'lucide-react'
import { api } from '~/trpc/react'
import { SummaryTreeRow } from './summary-tree-row'

interface FileFetchSummaryProps {
  jobId: string
}

/** How many distinct images the import will download; counts only, the browser never fetches them. */
export function FileFetchSummary({ jobId }: FileFetchSummaryProps) {
  const { data } = api.dataImport.getFileFetchCounts.useQuery({ jobId })

  if (!data || data.total === 0) return null

  return (
    <SummaryTreeRow
      icon={<ImageDown className='size-4 text-info' />}
      title={`${data.total.toLocaleString()} image${data.total === 1 ? '' : 's'} will be downloaded`}>
      {data.byColumn.length > 1 &&
        data.byColumn.map((column) => (
          <TreeRow
            key={column.jobPropertyId}
            depth={1}
            title={column.sourceColumnName ?? column.targetFieldKey}
            actions={
              <span className='shrink-0 pe-1 text-xs text-muted-foreground tabular-nums'>
                {column.count.toLocaleString()}
              </span>
            }
          />
        ))}
    </SummaryTreeRow>
  )
}
