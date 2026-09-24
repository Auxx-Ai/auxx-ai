// apps/web/src/components/data-import/plan-preview/file-fetch-summary.tsx

'use client'

import { ImageDown } from 'lucide-react'
import { api } from '~/trpc/react'

interface FileFetchSummaryProps {
  jobId: string
}

/** How many distinct images the import will download; counts only, the browser never fetches them. */
export function FileFetchSummary({ jobId }: FileFetchSummaryProps) {
  const { data } = api.dataImport.getFileFetchCounts.useQuery({ jobId })

  if (!data || data.total === 0) return null

  return (
    <div className='mx-4 rounded-2xl border bg-muted/40 px-3 py-2'>
      <div className='flex items-center gap-2'>
        <ImageDown className='size-4 text-info' />
        <span className='text-sm font-medium'>
          {data.total.toLocaleString()} image{data.total === 1 ? '' : 's'} will be downloaded
        </span>
      </div>
      {data.byColumn.length > 1 && (
        <div className='mt-2 flex flex-col gap-1 text-sm text-muted-foreground'>
          {data.byColumn.map((column) => (
            <span key={column.jobPropertyId}>
              {column.sourceColumnName ?? column.targetFieldKey}: {column.count.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
