// apps/web/src/components/datasets/documents/document-processing-toast.tsx

'use client'

import { useState, useMemo } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, FileText, Loader2, X, AlertCircle } from 'lucide-react'
import { Progress } from '@auxx/ui/components/progress'
import { cn } from '@auxx/ui/lib/utils'
import type { DocumentProcessingState } from '../hooks/use-document-processing'

/**
 * Props for DocumentProcessingToast component
 */
interface DocumentProcessingToastProps {
  /** Map of documentId -> processing state */
  processingStates: Map<string, DocumentProcessingState>
  /** Number of documents currently processing */
  activeCount: number
  /** Aggregate progress across all processing documents (0-100) */
  overallProgress: number
  /** Callback to dismiss the toast */
  onDismiss?: () => void
  /** Additional CSS classes */
  className?: string
}

/**
 * Compact toast component showing aggregate document processing progress
 * Can be expanded to show individual document progress
 */
export function DocumentProcessingToast({
  processingStates,
  activeCount,
  overallProgress,
  onDismiss,
  className,
}: DocumentProcessingToastProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Calculate counts
  const { completedCount, failedCount, processingCount } = useMemo(() => {
    let completed = 0
    let failed = 0
    let processing = 0

    for (const [, state] of processingStates) {
      if (state.status === 'completed') completed++
      else if (state.status === 'failed') failed++
      else processing++
    }

    return { completedCount: completed, failedCount: failed, processingCount: processing }
  }, [processingStates])

  // Get sorted states for display
  const sortedStates = useMemo(() => {
    return Array.from(processingStates.values()).sort((a, b) => {
      // Processing first, then completed, then failed
      const order = { processing: 0, connecting: 0, idle: 1, completed: 2, failed: 3 }
      return (order[a.status] ?? 4) - (order[b.status] ?? 4)
    })
  }, [processingStates])

  // Don't render if no documents
  if (processingStates.size === 0) {
    return null
  }

  const totalCount = processingStates.size
  const isAllComplete = completedCount === totalCount && totalCount > 0

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background shadow-lg',
        'animate-in slide-in-from-bottom-5 duration-300',
        className
      )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          {isAllComplete ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
          )}
          <span className="text-sm font-medium">
            {isAllComplete ? 'Processing complete' : `Processing ${processingCount} document${processingCount !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-muted"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-muted"
              aria-label="Dismiss">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Compact summary */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {completedCount}/{totalCount} complete
            {failedCount > 0 && <span className="text-red-500 ml-1">({failedCount} failed)</span>}
          </span>
          <span>{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} className="h-1.5" />
      </div>

      {/* Expanded list */}
      {isExpanded && sortedStates.length > 0 && (
        <div className="border-t max-h-48 overflow-y-auto">
          {sortedStates.map((state) => (
            <DocumentProgressItem key={state.documentId} state={state} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Individual document progress item in the expanded view
 */
function DocumentProgressItem({ state }: { state: DocumentProcessingState }) {
  const { filename, status, step, progress } = state

  // Calculate step-weighted progress for display
  const displayProgress = useMemo(() => {
    if (status === 'completed') return 100
    if (!step) return 0

    const stepWeights: Record<string, number> = {
      extraction: 0,
      chunking: 33,
      embedding: 66,
    }
    const base = stepWeights[step] ?? 0
    return Math.min(100, base + (progress / 100) * 33)
  }, [status, step, progress])

  return (
    <div className="flex items-center gap-2 p-2 border-b last:border-b-0">
      {/* Status icon */}
      {status === 'completed' ? (
        <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
      ) : status === 'failed' ? (
        <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-yellow-600 shrink-0" />
      )}

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs truncate" title={filename}>
            {filename}
          </span>
        </div>
        {status !== 'completed' && status !== 'failed' && (
          <div className="mt-1">
            <Progress value={displayProgress} className="h-1" />
          </div>
        )}
        {status === 'failed' && state.error && (
          <p className="text-xs text-red-500 mt-0.5 truncate" title={state.error}>
            {state.error}
          </p>
        )}
      </div>

      {/* Progress percentage */}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        {status === 'completed' ? '✓' : status === 'failed' ? '✗' : `${Math.round(displayProgress)}%`}
      </span>
    </div>
  )
}
