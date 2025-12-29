// apps/web/src/components/datasets/documents/document-processing-progress.tsx
'use client'

import { CheckCircle, Circle, Loader2 } from 'lucide-react'
import { Progress } from '@auxx/ui/components/progress'
import { cn } from '@auxx/ui/lib/utils'
import type { DocumentProcessingState } from '../hooks/use-document-processing'

/**
 * Props for DocumentProcessingProgress component
 */
interface DocumentProcessingProgressProps {
  /** Processing state from useDocumentProcessingSSE hook */
  state: DocumentProcessingState
  /** Compact mode for inline display */
  compact?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Processing steps configuration
 */
const steps = [
  { key: 'extraction', label: 'Extract' },
  { key: 'chunking', label: 'Chunk' },
  { key: 'embedding', label: 'Embed' },
] as const

type StepKey = (typeof steps)[number]['key']

/**
 * Component that displays document processing progress with step indicators
 */
export function DocumentProcessingProgress({
  state,
  compact = false,
  className,
}: DocumentProcessingProgressProps) {
  const { step, progress, segmentCount, currentSegment, status } = state

  // Calculate overall progress (0-100)
  const overallProgress = status === 'completed' ? 100 : calculateOverallProgress(step, progress)

  /**
   * Get the status of a processing step
   */
  const getStepStatus = (stepKey: StepKey): 'completed' | 'active' | 'pending' => {
    // If processing is complete, all steps are complete
    if (status === 'completed') return 'completed'

    const stepOrder: StepKey[] = ['extraction', 'chunking', 'embedding']
    const currentIndex = step ? stepOrder.indexOf(step) : -1
    const stepIndex = stepOrder.indexOf(stepKey)

    if (stepIndex < currentIndex) return 'completed'
    if (stepIndex === currentIndex) return 'active'
    return 'pending'
  }

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Loader2 className="h-3 w-3 animate-spin text-yellow-600" />
        <span className="text-xs text-muted-foreground">
          {step ? `${capitalize(step)}...` : 'Processing...'}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('space-y-3 w-full max-w-xs', className)}>
      {/* Step indicators */}
      <div className="flex items-center justify-between">
        {steps.map((s) => {
          const stepStatus = getStepStatus(s.key)
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              {stepStatus === 'completed' ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : stepStatus === 'active' ? (
                <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
              <span
                className={cn(
                  'text-xs',
                  stepStatus === 'completed' && 'text-green-600',
                  stepStatus === 'active' && 'text-yellow-600 font-medium',
                  stepStatus === 'pending' && 'text-muted-foreground/60'
                )}>
                {s.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <Progress value={overallProgress} className="h-1.5" />

      {/* Status text */}
      <p className="text-xs text-muted-foreground text-center">
        {status === 'completed' ? 'Complete' : getStatusText(step, progress, segmentCount, currentSegment)}
      </p>
    </div>
  )
}

/**
 * Calculate overall progress across all steps (0-100)
 */
function calculateOverallProgress(
  step: 'extraction' | 'chunking' | 'embedding' | null,
  stepProgress: number
): number {
  // Each step is ~33% of total
  const stepWeights: Record<string, number> = {
    extraction: 0,
    chunking: 33,
    embedding: 66,
  }
  const base = step ? stepWeights[step] ?? 0 : 0
  return Math.min(100, base + (stepProgress / 100) * 33)
}

/**
 * Get human-readable status text for current step
 */
function getStatusText(
  step: 'extraction' | 'chunking' | 'embedding' | null,
  progress: number,
  segmentCount: number,
  currentSegment: number
): string {
  if (!step) return 'Starting...'

  switch (step) {
    case 'extraction':
      return progress === 100 ? 'Text extracted' : 'Extracting text...'
    case 'chunking':
      return progress === 100 ? `Created ${segmentCount} segments` : 'Creating segments...'
    case 'embedding':
      return segmentCount > 0
        ? `Embedding ${currentSegment}/${segmentCount} segments`
        : 'Generating embeddings...'
    default:
      return 'Processing...'
  }
}

/**
 * Capitalize first letter of string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
