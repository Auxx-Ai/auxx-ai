// apps/web/src/components/workflow/nodes/core/http/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import {
  hasFailBranch as hasFailBranchFor,
  NodeFailBranch,
} from '~/components/workflow/nodes/shared/node-fail-branch'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import type { HttpNodeData } from './types'

export const HttpNode = memo<NodeProps<HttpNodeData>>(({ id, data, selected }) => {
  // Calculate total source handles based on error strategy
  // Same predicate the manifest's `connection.branches` uses, so the handle
  // this renders and the branch the catalog declares can never disagree.
  const hasFailBranch = hasFailBranchFor(data)
  const totalSourceHandles = hasFailBranch ? 2 : 1

  // Augment data with handle count for collapsed height calculation
  const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

  return (
    <BaseNode id={id} data={augmentedData} selected={selected} width={244} height='auto'>
      <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId='target' />
      <div className='space-y-1 pb-2'>
        <div className='relative px-2'>
          {/* Display method and URL if configured */}
          <div className='flex items-start justify-start rounded-md bg-primary-100 p-1'>
            <div className='flex h-4 shrink-0 items-center rounded-md px-1 text-xs font-semibold uppercase bg-accent-100 text-accent-500'>
              {data.method.toUpperCase()}
            </div>
            <div className='pl-1 text-xs break-all whitespace-pre-line'>{data.url}</div>
          </div>
          <NodeSourceHandle
            handleId='source'
            id={id}
            data={{ ...augmentedData, selected }}
            handleClassName='!bottom-5'
            handleIndex={0}
            handleTotal={totalSourceHandles}
          />
        </div>
        {hasFailBranch && <NodeFailBranch id={id} data={augmentedData} selected={selected} />}
      </div>
    </BaseNode>
  )
})

HttpNode.displayName = 'HttpNode'
