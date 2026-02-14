// apps/web/src/components/workflow/panels/run/components/loop-iteration-card.tsx

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { LoopIterationData } from '../../../store/run-store'
import { NodeExecutionCard } from './node-execution-card'

interface LoopIterationCardProps {
  iteration: LoopIterationData
  loopNodeId: string
}

/**
 * Helper function to get badge variant based on iteration status
 */
const getIterationStatusVariant = (status: LoopIterationData['status']) => {
  switch (status) {
    case 'running':
      return 'blue' as const
    case 'succeeded':
      return 'green' as const
    case 'failed':
      return 'destructive' as const
    default:
      return 'secondary' as const
  }
}

/**
 * Component to display a single loop iteration as an expandable section
 * Shows iteration info and nodes executed directly (no card wrapper)
 */
export function LoopIterationCard({ iteration, loopNodeId }: LoopIterationCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={cn(
        'space-y-0.5 bg-primary-50 border rounded-xl transition-colors duration-200',
        expanded && 'border-primary-300 bg-primary-100'
      )}>
      {/* Simple iteration header - no card styling */}
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex items-center  gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-muted/50 transition-colors'>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')}
        />
        <span className='text-sm font-medium'>
          Iteration {iteration.iterationIndex + 1} of {iteration.totalIterations}
        </span>
        <Badge variant={getIterationStatusVariant(iteration.status)} className='text-xs'>
          {iteration.status}
        </Badge>
      </button>

      {/* Nodes executed during this iteration - shown directly */}
      {expanded && (
        <div className='space-y-0.5 px-1.5 pb-1.5'>
          {iteration.executedNodes.length > 0 ? (
            iteration.executedNodes.map((nodeExecution) => (
              <NodeExecutionCard
                key={nodeExecution.id}
                execution={nodeExecution}
                workflowStatus={undefined}
              />
            ))
          ) : (
            <p className='text-sm text-muted-foreground py-4 text-center'>
              No nodes executed in this iteration
            </p>
          )}
        </div>
      )}
    </div>
  )
}
