// apps/web/src/components/workflow/panels/run/components/trace-tree-view.tsx

import type { WorkflowRunStatus } from '@auxx/database/types'
import type { LoopIterationData } from '~/components/workflow/store/run-store'
import type { TraceItem } from '../utils/trace-tree'
import { BranchGroup } from './branch-group'
import { LoopExecutionCard } from './loop-execution-card'
import { NodeExecutionCard } from './node-execution-card'

interface TraceTreeViewProps {
  items: TraceItem[]
  workflowStatus?: WorkflowRunStatus
  getLoopIterations: (loopNodeId: string) => LoopIterationData[]
}

/**
 * Render a trace level — node cards and the branches opened at this level.
 * Branches recurse, so nested forks nest visually instead of flattening.
 */
export function TraceTreeView({ items, workflowStatus, getLoopIterations }: TraceTreeViewProps) {
  return (
    <div className='space-y-0.5'>
      {items.map((item) => {
        if (item.type === 'branch') {
          return (
            <BranchGroup
              key={item.key}
              branchId={item.branchId}
              branchIndex={item.branchIndex}
              status={item.status}>
              <TraceTreeView
                items={item.children}
                workflowStatus={workflowStatus}
                getLoopIterations={getLoopIterations}
              />
            </BranchGroup>
          )
        }

        const { execution } = item
        if (execution.nodeType === 'loop') {
          return (
            <LoopExecutionCard
              key={execution.id}
              loopNodeExecution={execution}
              iterations={getLoopIterations(execution.nodeId)}
              workflowStatus={workflowStatus}
            />
          )
        }

        return (
          <NodeExecutionCard
            key={execution.id}
            execution={execution}
            workflowStatus={workflowStatus}
          />
        )
      })}
    </div>
  )
}
