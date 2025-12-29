// apps/web/src/components/workflow/nodes/core/text-classifier/node.tsx

'use client'

import React, { memo } from 'react'
import { Tags } from 'lucide-react'
import { BaseNode } from '../../shared/base/base-node'
import { type TextClassifierNode as TextClassifierNodeType } from './types'
import { NodeTargetHandle, NodeSourceHandle } from '../../../ui/node-handle'
import { generatePreviewElements } from './utils/preview-text'
import ModelNodeView from '~/components/workflow/ui/model-parameter/model-node-view'

/**
 * Text classifier node visual component
 */
export const TextClassifierNode = memo<TextClassifierNodeType>(
  ({ id, data, selected, width, height }) => {
    const categories = data?.categories || []

    // Total source handles: categories + unmatched
    const totalSourceHandles = categories.length + 1

    // Augment data with handle count for collapsed height calculation
    const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

    return (
      <BaseNode id={id} data={augmentedData} selected={selected} width={width || 244} height="auto">
        <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId="target" />

        <div className="px-3 pb-2">
          <div className="space-y-1">
            {data?.model ? (
              <ModelNodeView model={data.model} />
            ) : (
              <div className="text-[10px] text-primary-500 truncate">No model selected</div>
            )}

            {/* Text to classify preview */}
            {data?.text && (
              <div className="text-xs text-muted-foreground mb-2 p-2 bg-muted/30 rounded">
                {generatePreviewElements(data.text, id, 50)}
              </div>
            )}

            {/* Category connections */}
            {categories.map((category, index) => (
              <div
                key={category.id}
                className="relative flex items-center justify-between h-6 rounded-md bg-muted">
                <div className="text-xs font-medium text-primary-500 truncate ms-auto mr-2">
                  {category.name}
                </div>
                <NodeSourceHandle
                  id={id}
                  data={{ ...augmentedData, selected }}
                  handleId={category.id}
                  handleClassName="!top-1/2 !-right-[12px]"
                  handleIndex={index}
                  handleTotal={totalSourceHandles}
                />
              </div>
            ))}

            {/* Unmatched connection */}
            <div className="relative flex items-center justify-end p-1 bg-bad-50 rounded-md">
              <div className="text-xs rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line">
                Unmatched
              </div>
              <NodeSourceHandle
                id={id}
                data={{ ...augmentedData, selected }}
                handleId="unmatched"
                handleClassName="!top-1/2 !-right-[12px]"
                handleIndex={categories.length}
                handleTotal={totalSourceHandles}
              />
            </div>
          </div>
        </div>
      </BaseNode>
    )
  }
)

TextClassifierNode.displayName = 'TextClassifierNode'
