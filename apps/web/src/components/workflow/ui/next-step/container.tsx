// apps/web/src/components/workflow/nodes/base/next-step/container.tsx

import { cn } from '@auxx/ui/lib/utils'
import Add from './add'
import Item from './item'
import type { ContainerProps } from './types'

const Container = ({
  nodeId,
  nodeData,
  sourceHandle,
  nextNodes,
  branchName,
  branchType = 'default',
  // isFailBranch,
}: ContainerProps) => {
  return (
    <div
      className={cn(
        'space-y-0.5 rounded-[10px] bg-muted p-0.5',
        branchType === 'fail' && 'border-[0.5px] border-bad-200 bg-bad-50'
      )}>
      {branchName && (
        <div
          className={cn(
            'flex items-center truncate px-2 text-xs font-semibold uppercase text-muted-foreground',
            branchType === 'fail' && 'text-bad-600'
          )}
          title={branchName}>
          {branchName}
        </div>
      )}
      <div className='space-y-0.5'>
        {nextNodes.map((nextNode) => (
          <Item key={nextNode.id} nodeId={nextNode.id} data={nextNode.data} sourceHandle='source' />
        ))}
      </div>
      <Add
        isParallel={!!nextNodes.length}
        branchType={branchType}
        // isFailBranch={isFailBranch}
        nodeId={nodeId}
        nodeData={nodeData}
        sourceHandle={sourceHandle}
      />
    </div>
  )
}

export default Container
