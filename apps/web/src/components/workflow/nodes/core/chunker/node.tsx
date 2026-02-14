// apps/web/src/components/workflow/nodes/core/chunker/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'
import type { ChunkerNode as ChunkerNodeType } from './types'

/**
 * Chunker node component for the workflow canvas
 * Displays chunking configuration summary with VariableTag for variable references
 */
export const ChunkerNode = memo<ChunkerNodeType>(({ id, data, selected }) => {
  const hasContent = !!data.content

  // Check if fields are in variable mode (not constant)
  const isChunkSizeVariable =
    !data.fieldModes?.chunkSize &&
    typeof data.chunkSize === 'string' &&
    isNodeVariable(data.chunkSize)
  const isChunkOverlapVariable =
    !data.fieldModes?.chunkOverlap &&
    typeof data.chunkOverlap === 'string' &&
    isNodeVariable(data.chunkOverlap)
  const isDelimiterVariable =
    !data.fieldModes?.delimiter &&
    typeof data.delimiter === 'string' &&
    isNodeVariable(data.delimiter)

  // Get display values for constants
  const chunkSizeValue = typeof data.chunkSize === 'number' ? data.chunkSize : 1000
  const chunkOverlapValue = typeof data.chunkOverlap === 'number' ? data.chunkOverlap : 50
  const delimiterValue = data.delimiter || '\\n\\n'

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='space-y-1 pb-2'>
        <div className='relative px-2'>
          {hasContent ? (
            <div className='space-y-1 mt-1'>
              {/* Chunk size */}
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <span>Size:</span>
                {isChunkSizeVariable ? (
                  <VariableTag variableId={data.chunkSize as string} nodeId={id} />
                ) : (
                  <span className='font-mono text-primary-600'>{chunkSizeValue}</span>
                )}
              </div>

              {/* Chunk overlap */}
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <span>Overlap:</span>
                {isChunkOverlapVariable ? (
                  <VariableTag variableId={data.chunkOverlap as string} nodeId={id} />
                ) : (
                  <span className='font-mono text-primary-600'>{chunkOverlapValue}</span>
                )}
              </div>

              {/* Delimiter */}
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <span>Delimiter:</span>
                {isDelimiterVariable ? (
                  <VariableTag variableId={data.delimiter as string} nodeId={id} />
                ) : (
                  <span className='font-mono text-primary-600 truncate max-w-[120px]'>
                    {delimiterValue}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className='text-xs text-primary-400 mt-1'>Not configured</div>
          )}

          <NodeSourceHandle
            handleId='source'
            id={id}
            data={{ ...data, selected }}
            handleClassName='!bottom-5'
            handleIndex={0}
            handleTotal={1}
          />
        </div>
      </div>
    </BaseNode>
  )
})

ChunkerNode.displayName = 'ChunkerNode'
