// apps/web/src/components/data-import/plan-preview/error-summary.tsx

'use client'

import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { api } from '~/trpc/react'

interface ErrorSummaryProps {
  errorCount: number
  planId: string
}

/**
 * Summary of rows with errors.
 */
export function ErrorSummary({ errorCount, planId }: ErrorSummaryProps) {
  const { data: errors } = api.dataImport.getPlanErrors.useQuery(
    { planId, limit: 5 },
    { enabled: errorCount > 0 }
  )

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {errorCount} {errorCount === 1 ? 'row has' : 'rows have'} errors
      </AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-2">These rows will be skipped during import:</p>
        <ul className="text-sm space-y-1">
          {errors?.map((error, i) => (
            <li key={i} className="font-mono">
              Row {error.rowIndex + 1}: {error.error}
            </li>
          ))}
        </ul>
        {errorCount > 5 && <p className="text-sm mt-2">...and {errorCount - 5} more</p>}
      </AlertDescription>
    </Alert>
  )
}
