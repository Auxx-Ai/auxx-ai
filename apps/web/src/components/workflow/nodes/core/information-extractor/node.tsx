// apps/web/src/components/workflow/nodes/core/information-extractor/node.tsx

'use client'

import { memo } from 'react'
import type { NodeProps } from '~/components/workflow/types'
import ModelNodeView from '~/components/workflow/ui/model-parameter/model-node-view'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import { AiModelMode } from '../ai/types'
import type { InformationExtractorNodeData } from './types'

/**
 * Information Extractor node visual component
 */
export const InformationExtractorNode = memo<NodeProps<InformationExtractorNodeData>>(
  ({ id, data, selected = false }) => {
    const hasSchema = data.structured_output?.enabled && data.structured_output.schema
    const fieldCount = hasSchema
      ? Object.keys(data.structured_output.schema?.properties || {}).length
      : 0

    return (
      <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
        <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />

        <div className='w-full px-3 py-2'>
          {/*
            InformationExtractorModel declares `mode` as a string-literal union and
            `completion_params` as optional; ModelNodeView wants the AI node's
            AiModelMode enum and a present params object. Map rather than cast.
          */}
          <ModelNodeView
            model={{
              ...data.model,
              mode: data.model.mode === 'completion' ? AiModelMode.COMPLETION : AiModelMode.CHAT,
              completion_params: data.model.completion_params ?? {},
            }}
          />

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
