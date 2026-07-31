// apps/web/src/components/workflow/nodes/core/answer/node.tsx

import { memo } from 'react'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { AnswerNodeData } from './types'

export const AnswerNode = memo<NodeProps<AnswerNodeData>>(({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} selected={selected} className='answer-node'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <NodeSourceHandle id={id} data={{ ...data, selected }} handleId='source' />
    </BaseNode>
  )
})

AnswerNode.displayName = 'AnswerNode'
