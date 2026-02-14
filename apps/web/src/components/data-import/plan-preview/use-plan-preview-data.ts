// apps/web/src/components/data-import/plan-preview/use-plan-preview-data.ts

'use client'

import { useCallback, useState } from 'react'
import { api } from '~/trpc/react'
import type { PlanPreviewRow, StrategyCounts } from './types'

interface UsePlanPreviewDataOptions {
  jobId: string
  /** Current job status */
  jobStatus?: string
}

interface UsePlanPreviewDataResult {
  /** Combined rows from SSE and/or query */
  rows: PlanPreviewRow[]
  /** Total row count (from SSE or query) */
  total: number
  /** Whether data is loading */
  isLoading: boolean
  /** Whether planning is in progress (receiving SSE) */
  isPlanning: boolean
  /** Add a row from SSE event */
  addRow: (row: PlanPreviewRow) => void
  /** Clear SSE rows (when planning restarts) */
  clearRows: () => void
  /** Strategy counts */
  strategyCounts: StrategyCounts
}

/**
 * Hook to manage plan preview data from both SSE (real-time) and API (hydration).
 *
 * During planning: Accumulates rows from SSE events
 * After refresh: Loads rows from getPlanPreview query
 */
export function usePlanPreviewData(options: UsePlanPreviewDataOptions): UsePlanPreviewDataResult {
  const { jobId, jobStatus } = options

  // SSE-accumulated rows
  const [sseRows, setSseRows] = useState<PlanPreviewRow[]>([])
  const isPlanning = jobStatus === 'planning'

  // Query for hydration (only when planning complete and no SSE rows)
  const shouldFetchFromDb = jobStatus === 'ready' && sseRows.length === 0
  const { data: dbData, isLoading: isLoadingDb } = api.dataImport.getPlanPreview.useQuery(
    { jobId, limit: 500 },
    { enabled: shouldFetchFromDb }
  )

  // Add row from SSE
  const addRow = useCallback((row: PlanPreviewRow) => {
    setSseRows((prev) => [...prev, row])
  }, [])

  // Clear rows (when planning restarts)
  const clearRows = useCallback(() => {
    setSseRows([])
  }, [])

  // Determine which rows to use, normalizing DB rows to frontend format
  const dbRows: PlanPreviewRow[] =
    dbData?.rows.map((row) => ({
      ...row,
      errors: row.errorMessage ? [row.errorMessage] : [],
    })) ?? []
  const rows = sseRows.length > 0 ? sseRows : dbRows
  const total = sseRows.length > 0 ? sseRows.length : (dbData?.total ?? 0)

  // Calculate strategy counts
  const strategyCounts = rows.reduce<StrategyCounts>(
    (acc, row) => {
      acc[row.strategy]++
      return acc
    },
    { create: 0, update: 0, skip: 0 }
  )

  return {
    rows,
    total,
    isLoading: shouldFetchFromDb && isLoadingDb,
    isPlanning,
    addRow,
    clearRows,
    strategyCounts,
  }
}
