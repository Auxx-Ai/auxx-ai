// apps/web/src/components/workflow/nodes/core/manual/node.tsx

import { type FC, memo } from 'react'
import type { ManualNodeData } from './types'
import { BaseNode } from '../../shared/base/base-node'
import { NodeSourceHandle, NodeInputHandle } from '~/components/workflow/ui/node-handle'

export interface ManualNode {
  id: string
  data: ManualNodeData
  selected?: boolean
}

/**
 * Manual trigger node component
 */
export const ManualNode: FC<ManualNode> = memo((props) => {
  const { id, data, selected } = props

  return (
    <BaseNode id={id} data={data} selected={selected}>
      {/* Regular source handle for workflow flow */}
      <NodeSourceHandle id={id} data={{ ...data, selected }} handleId="source" />

      {/* Special input handle for input nodes */}
      <NodeInputHandle
        id={id}
        data={{ ...data, selected }}
        handleId="input"
        handleClassName=" top-1/2 -translate-y-1/2"
      />
    </BaseNode>
  )
})

ManualNode.displayName = 'ManualNode'
