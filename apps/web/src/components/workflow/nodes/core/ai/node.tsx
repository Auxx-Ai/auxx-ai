// apps/web/src/components/workflow/nodes/core/ai/node.tsx

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import {
  hasFailBranch as hasFailBranchFor,
  NodeFailBranch,
} from '~/components/workflow/nodes/shared/node-fail-branch'
import type { NodeProps } from '~/components/workflow/types'
import ModelNodeView from '~/components/workflow/ui/model-parameter/model-node-view'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import type { AiNodeData } from './types'

export const AiNode = memo<NodeProps<AiNodeData>>(({ id, data, selected }) => {
  // The fail lane renders off the STORED `error_strategy` — the same predicate
  // `connection.branches` uses, so the handle this renders and the branch the
  // catalog declares can never disagree. A node that predates the step-4
  // opt-in carries no key and renders exactly what it always did.
  const hasFailBranch = hasFailBranchFor(data)
  const totalSourceHandles = hasFailBranch ? 2 : 1
  const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

  return (
    <BaseNode id={id} data={augmentedData} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId='target' />

      <div className='px-2 pb-2'>
        <div className='space-y-1'>
          {data?.model ? (
            <ModelNodeView model={data.model} />
          ) : (
            <div className='text-[10px] text-primary-500 truncate'>No model selected</div>
          )}
          {data?.prompt_template && data.prompt_template.length > 0 && (
            <div className='text-[10px]'>
              {data.prompt_template.length} prompt{data.prompt_template.length !== 1 ? 's' : ''}
            </div>
          )}
          {data?.toolsEnabled && (
            <div className='text-[10px] flex items-center gap-1'>
              <span>🔧</span>
              <span>{(data.toolsets ?? []).filter((t) => t.enabled).length} tools</span>
            </div>
          )}
        </div>
      </div>

      <NodeSourceHandle
        id={id}
        data={{ ...augmentedData, selected }}
        handleId='source'
        handleClassName='!bottom-5'
        handleIndex={0}
        handleTotal={totalSourceHandles}
      />
      {hasFailBranch && <NodeFailBranch id={id} data={augmentedData} selected={selected} />}
    </BaseNode>
  )
})

AiNode.displayName = 'AiNode'
