// apps/web/src/components/data-import/hooks/use-unique-values.ts

'use client'

import { api } from '~/trpc/react'
import type { UniqueValueSummary } from '../types'

interface UseUniqueValuesOptions {
  jobId: string
  columnIndex: number
  enabled?: boolean
}

/**
 * Hook for fetching unique values for a column.
 */
export function useUniqueValues({ jobId, columnIndex, enabled = true }: UseUniqueValuesOptions) {
  const { data, isLoading, error, refetch } = api.dataImport.getUniqueValues.useQuery(
    { jobId, columnIndex },
    { enabled }
  )

  // Group values by status for easier consumption
  const grouped = data?.reduce(
    (acc, value) => {
      acc[value.resolutionStatus].push(value)
      return acc
    },
    {
      pending: [] as UniqueValueSummary[],
      valid: [] as UniqueValueSummary[],
      error: [] as UniqueValueSummary[],
      warning: [] as UniqueValueSummary[],
      create: [] as UniqueValueSummary[],
    }
  )

  return {
    values: data ?? [],
    grouped,
    isLoading,
    error,
    refetch,
    errorCount: grouped?.error.length ?? 0,
    warningCount: grouped?.warning.length ?? 0,
    createCount: grouped?.create.length ?? 0,
  }
}
