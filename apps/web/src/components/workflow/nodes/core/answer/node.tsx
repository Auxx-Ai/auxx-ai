// apps/web/src/components/workflow/nodes/core/answer/node.tsx

import { Handle, Position } from '@xyflow/react'
import { memo } from 'react'
import { NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { AnswerNode as AnswerNodeType } from './types'

export const AnswerNode = memo<AnswerNodeType>(({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} selected={selected} className='answer-node'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />

      {/* <Handle type="target" position={Position.Left} id="input" className="node-handle" /> */}

      {/* <div className="node-content p-3">
        <div className="node-header flex items-center gap-2 mb-2">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="node-title font-medium">{data.config.title}</span>
        </div>
        <div className="node-body">
          <div className="text-xs text-muted-foreground">
            {data.config.response_type || 'reply'}
          </div>
        </div>
      </div> */}
    </BaseNode>
  )
})

AnswerNode.displayName = 'AnswerNode'
