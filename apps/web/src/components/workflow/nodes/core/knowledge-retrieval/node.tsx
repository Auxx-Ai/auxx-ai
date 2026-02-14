// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'
import type { KnowledgeRetrievalNode as KnowledgeRetrievalNodeType } from './types'

/**
 * Knowledge Retrieval node component for the workflow canvas
 * Displays search configuration summary with VariableTag for variable references
 */
export const KnowledgeRetrievalNode = memo<KnowledgeRetrievalNodeType>(({ id, data, selected }) => {
  const hasQuery = !!data.query
  const datasetCount = data.datasets?.length ?? 0
  const hasDatasets = datasetCount > 0

  // Check if query is in variable mode
  const isQueryVariable =
    !data.fieldModes?.query && typeof data.query === 'string' && isNodeVariable(data.query)

  // Get search type display
  const searchTypeDisplay =
    data.searchType === 'hybrid'
      ? 'Hybrid'
      : data.searchType === 'vector'
        ? 'Vector'
        : data.searchType === 'text'
          ? 'Full-Text'
          : 'Hybrid'

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='space-y-1 pb-2'>
        <div className='relative px-2'>
          {hasQuery || hasDatasets ? (
            <div className='space-y-1 mt-1'>
              {/* Query */}
              {hasQuery && (
                <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <span>Query:</span>
                  {isQueryVariable ? (
                    <VariableTag variableId={data.query as string} nodeId={id} />
                  ) : (
                    <span className='font-mono text-primary-600 truncate max-w-[140px]'>
                      {data.query}
                    </span>
                  )}
                </div>
              )}

              {/* Datasets */}
              {hasDatasets && (
                <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <span>Datasets:</span>
                  <span className='font-mono text-primary-600'>
                    {datasetCount} {datasetCount === 1 ? 'dataset' : 'datasets'}
                  </span>
                </div>
              )}

              {/* Search Type */}
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <span>Search:</span>
                <span className='font-mono text-primary-600'>{searchTypeDisplay}</span>
              </div>

              {/* Limit */}
              {data.limit && (
                <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <span>Limit:</span>
                  <span className='font-mono text-primary-600'>{data.limit}</span>
                </div>
              )}
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

KnowledgeRetrievalNode.displayName = 'KnowledgeRetrievalNode'
