// apps/web/src/components/workflow/nodes/core/dataset/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import { type DatasetNode as DatasetNodeType } from './types'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'

/**
 * Dataset node component for the workflow canvas
 * Displays dataset configuration summary with VariableTag for variable references
 */
export const DatasetNode = memo<DatasetNodeType>(({ id, data, selected }) => {
  const hasDataset = !!data.datasetId
  const hasChunks = !!data.chunks

  // Check if fields are in variable mode (not constant)
  const isDatasetVariable =
    !data.fieldModes?.datasetId &&
    typeof data.datasetId === 'string' &&
    isNodeVariable(data.datasetId)
  const isChunksVariable =
    !data.fieldModes?.chunks && typeof data.chunks === 'string' && isNodeVariable(data.chunks)
  const isDocTitleVariable =
    !data.fieldModes?.documentTitle &&
    typeof data.documentTitle === 'string' &&
    isNodeVariable(data.documentTitle)

  // Get display values for constants
  const documentTitleValue = data.documentTitle || 'Untitled'

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height="auto">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />
      <div className="space-y-1 pb-2">
        <div className="relative px-2">
          {hasDataset || hasChunks ? (
            <div className="space-y-1 mt-1">
              {/* Dataset */}
              {hasDataset && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Dataset:</span>
                  {isDatasetVariable ? (
                    <VariableTag variableId={data.datasetId as string} nodeId={id} />
                  ) : (
                    <span className="font-mono text-primary-600 truncate max-w-[140px]">
                      {data.datasetId}
                    </span>
                  )}
                </div>
              )}

              {/* Chunks */}
              {hasChunks && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Chunks:</span>
                  {isChunksVariable ? (
                    <VariableTag variableId={data.chunks as string} nodeId={id} />
                  ) : (
                    <span className="font-mono text-primary-600">configured</span>
                  )}
                </div>
              )}

              {/* Document Title */}
              {data.documentTitle && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Title:</span>
                  {isDocTitleVariable ? (
                    <VariableTag variableId={data.documentTitle as string} nodeId={id} />
                  ) : (
                    <span className="font-mono text-primary-600 truncate max-w-[140px]">
                      {documentTitleValue}
                    </span>
                  )}
                </div>
              )}

              {/* Skip Embedding indicator */}
              {data.skipEmbedding && (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <span>Skip Embedding</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-primary-400 mt-1">Not configured</div>
          )}

          <NodeSourceHandle
            handleId="source"
            id={id}
            data={{ ...data, selected }}
            handleClassName="!bottom-5"
            handleIndex={0}
            handleTotal={1}
          />
        </div>
      </div>
    </BaseNode>
  )
})

DatasetNode.displayName = 'DatasetNode'
