// apps/web/src/components/workflow/share/workflow-execution-result.tsx
'use client'

import { Loader2, Play } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { useWorkflowShareStore } from './workflow-share-provider'
import { ExecutionResultCard } from './execution-result-card'

/**
 * Full-panel execution result display
 * Shows End node outputs in a chat-like interface
 * Supports multiple End nodes with progressive loading
 */
export function WorkflowExecutionResult() {
  const currentRun = useWorkflowShareStore((s) => s.currentRun)

  // Empty state - no run yet
  if (!currentRun) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Play />
          </EmptyMedia>
          <EmptyTitle>No results yet</EmptyTitle>
          <EmptyDescription>Run the workflow to see results here</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const { status, endNodeResults, error } = currentRun

  // Workflow-level loading state (before any end nodes start)
  if ((status === 'running' || status === 'pending') && endNodeResults.length === 0) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>Running workflow...</EmptyTitle>
          <EmptyDescription>Please wait while the workflow executes</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Cancelled state
  if (status === 'cancelled') {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Workflow was cancelled</p>
      </div>
    )
  }

  // Workflow-level error - show error banner with any completed results below
  // Note: We filter out "running" end nodes since they'll never complete after workflow fails
  if (status === 'failed' && error) {
    const completedResults = endNodeResults.filter((r) => r.status !== 'running')

    return (
      <div className="relative flex h-full flex-col bg-muted/30">
        <div className="flex h-0 grow flex-col overflow-y-auto px-14 py-8 space-y-4">
          {/* Error banner */}
          <div className="relative rounded-2xl border-t border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-sm font-medium text-muted-foreground">Error</span>
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <span>Failed</span>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none text-destructive">
                <p className="whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          </div>

          {/* Any completed results before the failure */}
          {completedResults.length > 0 && (
            <div className="space-y-4">
              {completedResults.map((result) => (
                <ExecutionResultCard key={result.nodeId} result={result} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Result state - show end node results
  return (
    <div className="relative flex h-full flex-col bg-muted/30">
      <div className="flex h-0 grow flex-col overflow-y-auto px-14 py-8 max-w-4xl min-w">
        <div className="space-y-4">
          {endNodeResults.map((result) => (
            <ExecutionResultCard key={result.nodeId} result={result} />
          ))}
        </div>
      </div>
    </div>
  )
}
