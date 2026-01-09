// apps/web/src/components/data-import/progress/execution-progress.tsx

'use client'

import { Loader2 } from 'lucide-react'
import { EntityIcon } from '@auxx/ui/components/icons'
import type { ExecutionProgress as ExecutionProgressType } from '../types'

interface ExecutionProgressProps {
  progress: ExecutionProgressType
  isConnected: boolean
}

/**
 * Real-time progress indicator for import execution.
 * Updates via SSE connection.
 */
export function ExecutionProgress({ progress, isConnected }: ExecutionProgressProps) {
  const percentage =
    progress.totalRows > 0 ? Math.round((progress.rowsProcessed / progress.totalRows) * 100) : 0

  const phaseLabel = {
    idle: 'Idle...',
    preparing: 'Preparing import...',
    executing: 'Importing data...',
    complete: 'Import complete!',
    error: 'Import failed',
  }[progress.phase]

  const strategyLabel = progress.currentStrategy
    ? { create: 'Creating records', update: 'Updating records', skip: 'Skipping records' }[
        progress.currentStrategy
      ]
    : null

  return (
    <div className="flex flex-col items-center justify-center flex-1">
      <div className="w-full max-w-[360px] border rounded-2xl overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <EntityIcon iconId="upload" variant="muted" />
            <div className="min-w-0">
              <p className="font-medium text-sm">{phaseLabel}</p>
              <p className="text-sm text-muted-foreground">{strategyLabel ?? 'Processing rows'}</p>
            </div>
          </div>
          <Loader2 className="size-5 text-primary animate-spin" />
        </div>

        {/* Progress bar */}
        <div className="p-4 border-b">
          <div className="relative w-full h-2 bg-primary-200 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary-500 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-muted-foreground">
              {progress.rowsProcessed.toLocaleString()} of {progress.totalRows.toLocaleString()}{' '}
              rows
            </span>
            <span className="font-medium">{percentage}%</span>
          </div>
        </div>

        {/* Stats rows */}
        <div className="divide-y">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              <EntityIcon iconId="list" color="gray" size="sm" />
              <span className="text-sm text-muted-foreground">Processed</span>
            </div>
            <p className="text-lg font-bold">{progress.rowsProcessed.toLocaleString()}</p>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              <EntityIcon iconId="plus" color="green" size="sm" />
              <span className="text-sm text-green-600">Created</span>
            </div>
            <p className="text-lg font-bold text-green-600">{progress.created.toLocaleString()}</p>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              <EntityIcon iconId="refresh" color="blue" size="sm" />
              <span className="text-sm text-info">Updated</span>
            </div>
            <p className="text-lg font-bold text-info">{progress.updated.toLocaleString()}</p>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2">
              <EntityIcon iconId="alert-circle" color="red" size="sm" />
              <span className="text-sm text-red-600">Failed</span>
            </div>
            <p className="text-lg font-bold text-red-600">{progress.failed.toLocaleString()}</p>
          </div>
          {/* Connection status */}
          <div className="flex items-center justify-center gap-2 p-3 bg-muted/30 text-xs text-muted-foreground">
            <div className={`size-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? 'Connected' : 'Reconnecting...'}
          </div>
        </div>
      </div>
    </div>
  )
}
