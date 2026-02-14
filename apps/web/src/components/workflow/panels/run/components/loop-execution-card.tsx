// apps/web/src/components/workflow/panels/run/components/loop-execution-card.tsx

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/models'
import type { WorkflowRunStatus } from '@auxx/database/types'
import type { LoopIterationData } from '../../../store/run-store'
import { LoopIterationCard } from './loop-iteration-card'
import { NodeExecutionCard } from './node-execution-card'

interface LoopExecutionCardProps {
  loopNodeExecution: WorkflowNodeExecution
  iterations: LoopIterationData[]
  workflowStatus?: WorkflowRunStatus
}

/**
 * Wrapper component for loop node executions
 * Displays loop node details and its iterations as children
 */
export function LoopExecutionCard({
  loopNodeExecution,
  iterations,
  workflowStatus,
}: LoopExecutionCardProps) {
  return (
    <NodeExecutionCard execution={loopNodeExecution} workflowStatus={workflowStatus}>
      {/* Loop iterations as children */}
      {iterations.length > 0 && (
        <div className='space-y-0.5'>
          <div className='text-sm font-medium text-muted-foreground mb-2'>
            Iterations ({iterations.length})
          </div>
          {iterations.map((iteration) => (
            <LoopIterationCard
              key={iteration.iterationIndex}
              iteration={iteration}
              loopNodeId={loopNodeExecution.nodeId}
            />
          ))}
        </div>
      )}
    </NodeExecutionCard>
  )
}
