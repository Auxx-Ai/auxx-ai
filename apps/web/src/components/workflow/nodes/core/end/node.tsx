// apps/web/src/components/workflow/nodes/core/end/node.tsx

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { type EndNode as EndNodeType } from './types'
import { NodeTargetHandle, NodeSourceHandle } from '~/components/workflow/ui/node-handle'

/**
 * Visual representation of the End node
 */
export const EndNode = memo<EndNodeType>(({ id, data, selected, width, height }) => {
  const outputCount = data?.outputs?.length || 0

  return (
    <BaseNode id={id} data={data} selected={selected} width={width || 244} height="auto">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />

      <div className="px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {outputCount === 0
            ? 'No outputs defined'
            : `${outputCount} output${outputCount > 1 ? 's' : ''} defined`}
        </div>
      </div>

      <NodeSourceHandle
        id={id}
        data={{ ...data, selected }}
        handleId="source"
        handleClassName="!bottom-5"
      />
    </BaseNode>
  )
})

EndNode.displayName = 'EndNode'
