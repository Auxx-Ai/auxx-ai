// apps/web/src/components/workflow/nodes/core/ai/node.tsx

import React, { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { type AiNode as AiNodeType } from './types'
import ModelNodeView from '~/components/workflow/ui/model-parameter/model-node-view'
import { NodeTargetHandle, NodeSourceHandle } from '~/components/workflow/ui/node-handle'

export const AiNode = memo<AiNodeType>(({ id, data, selected, width, height }) => {
  return (
    <BaseNode id={id} data={data} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />

      <div className="px-2 pb-2">
        <div className="space-y-1">
          {data?.model ? (
            <ModelNodeView model={data.model} />
          ) : (
            <div className="text-[10px] text-primary-500 truncate">No model selected</div>
          )}
          {data?.prompt_template && data.prompt_template.length > 0 && (
            <div className="text-[10px]">
              {data.prompt_template.length} prompt{data.prompt_template.length !== 1 ? 's' : ''}
            </div>
          )}
          {data?.tools?.enabled && (
            <div className="text-[10px] flex items-center gap-1">
              <span>🔧</span>
              <span>
                {(data.tools.allowedNodeIds?.length || 0) +
                  (data.tools.allowedBuiltInTools?.length || 0)}{' '}
                tools
              </span>
            </div>
          )}
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

AiNode.displayName = 'AiNode'
