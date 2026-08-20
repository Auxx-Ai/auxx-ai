// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import {
  hasFailBranch as hasFailBranchFor,
  NodeFailBranch,
} from '~/components/workflow/nodes/shared/node-fail-branch'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'
import type { KnowledgeRetrievalNodeData } from './types'

/**
 * Knowledge Retrieval node component for the workflow canvas
 * Displays search configuration summary with VariableTag for variable references
 */
export const KnowledgeRetrievalNode = memo<NodeProps<KnowledgeRetrievalNodeData>>(
  ({ id, data, selected }) => {
    const hasQuery = !!data.query
    const sourceCount = data.sources?.length ?? 0
    const hasSources = sourceCount > 0

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

    // The fail lane renders off the STORED `error_strategy` — the same predicate
    // `connection.branches` uses, so the handle this renders and the branch the
    // catalog declares can never disagree. A node that predates the step-4
    // opt-in carries no key and renders exactly what it always did.
    const hasFailBranch = hasFailBranchFor(data)
    const totalSourceHandles = hasFailBranch ? 2 : 1
    const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

    return (
      <BaseNode id={id} data={augmentedData} selected={selected} width={244} height='auto'>
        <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId='target' />
        <div className='space-y-1 pb-2'>
          <div className='relative px-2'>
            {hasQuery || hasSources ? (
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

                {/* Knowledge sources */}
                {hasSources && (
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <span>Knowledge:</span>
                    <span className='font-mono text-primary-600'>
                      {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
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
  }
)

KnowledgeRetrievalNode.displayName = 'KnowledgeRetrievalNode'
