// apps/web/src/components/data-import/plan-preview/plan-preview-table.tsx

'use client'

import { useMemo } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { DynamicTable } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import { usePlanPreviewColumns } from './use-plan-preview-columns'
import type { PlanPreviewRow, PreviewColumnMapping } from './types'

interface PlanPreviewTableProps {
  /** Preview rows to display */
  rows: PlanPreviewRow[]
  /** Column mappings from import job */
  mappings: PreviewColumnMapping[]
  /** Whether planning is in progress */
  isPlanning?: boolean
  /** Whether data is loading */
  isLoading?: boolean
}

/**
 * Plan preview table showing what will happen when import executes.
 * Uses DynamicTable with minimal features (no bulk actions, no cell editing).
 */
export function PlanPreviewTable({
  rows,
  mappings,
  isPlanning = false,
  isLoading = false,
}: PlanPreviewTableProps) {
  // Generate columns from mappings
  const columns = usePlanPreviewColumns({ mappings })

  // Custom empty state
  const emptyState = useMemo(() => {
    if (isPlanning) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Analyzing rows...</p>
        </div>
      )
    }
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="No preview available"
        description="Generate a plan to see the preview"
      />
    )
  }, [isPlanning])

  return (
    <div className="h-full flex flex-col dark:bg-muted/10 overflow-hidden">
      <DynamicTable
        data={rows}
        columns={columns}
        tableId="plan-preview"
        className="h-full"
        isLoading={isLoading}
        enableSearch={false}
        enableSorting={true}
        enableFiltering={false}
        showRowNumbers={false}
        hideToolbar
        standalone
        emptyState={emptyState}
        getRowId={(row) => String(row.rowIndex)}
      />
    </div>
  )
}
