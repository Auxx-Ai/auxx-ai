// apps/web/src/components/workflow/nodes/core/http/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import { ErrorStrategy, type HttpNode as HttpNodeType } from './types'

export const HttpNode = memo<HttpNodeType>(({ id, data, selected }) => {
  // Calculate total source handles based on error strategy
  const hasFailBranch = data.error_strategy === ErrorStrategy.fail
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
        {hasFailBranch && (
          <div className='relative px-2'>
            <div className='flex items-center justify-between rounded-md bg-primary-100 p-1 text-xs'>
              <div className='h-4 rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line'>
                On Failure
              </div>
              <div className='text-primary-500'>Fail Branch</div>
            </div>
            <NodeSourceHandle
              id={id}
              handleId='fail'
              type='fail'
              data={{ ...augmentedData, selected }}
              handleClassName='!bottom-5'
              handleIndex={1}
              handleTotal={totalSourceHandles}
            />
          </div>
        )}
      </div>
    </BaseNode>
  )
})

HttpNode.displayName = 'HttpNode'
