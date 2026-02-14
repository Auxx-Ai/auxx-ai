// apps/web/src/components/workflow/nodes/core/information-extractor/node.tsx

'use client'

import { FileJson } from 'lucide-react'
import React, { memo } from 'react'
import ModelNodeView from '~/components/workflow/ui/model-parameter/model-node-view'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { InformationExtractorNode as InformationExtractorNodeType } from './types'

/**
 * Information Extractor node visual component
 */
export const InformationExtractorNode = memo<InformationExtractorNodeType>(
  ({ id, data, selected = false }) => {
    const hasSchema = data.structured_output?.enabled && data.structured_output.schema
    const fieldCount = hasSchema
      ? Object.keys(data.structured_output.schema?.properties || {}).length
      : 0

    return (
      <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
        <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />

        <div className='w-full px-3 py-2'>
          <ModelNodeView model={data.model} />

          {/* Schema status */}
          {data.structured_output?.enabled && (
            <div className=''>
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>
                  {hasSchema
                    ? `${fieldCount} field${fieldCount !== 1 ? 's' : ''} configured`
                    : 'No schema configured'}
                </span>
                {hasSchema && (
                  <div className='flex items-center gap-1 text-success'>
                    <div className='w-1.5 h-1.5 bg-success rounded-full' />
                    <span>Ready</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Output indication */}
          <div className='px-3 pt-2'>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-muted-foreground'>Extracted Data</span>
              <NodeSourceHandle
                id={id}
                data={{ ...data, selected }}
                handleId='source'
                // handleClassName="!top-1/2 !-right-[12px]"
              />
            </div>
          </div>
        </div>
      </BaseNode>
    )
  }
)

InformationExtractorNode.displayName = 'InformationExtractorNode'
