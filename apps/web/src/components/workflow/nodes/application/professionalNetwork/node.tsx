// 🤖 AUTO-GENERATED from professionalNetwork.config.json - DO NOT EDIT

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import type { ProfessionalNetworkNodeProps } from './types'

export const ProfessionalNetworkNode = memo<ProfessionalNetworkNodeProps>(({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} selected={selected} width={260} height="auto">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />
      
      <div className="space-y-2 pb-2">
        {/* Node Header */}
        <div className="relative px-2">
          <div className="flex items-center justify-between rounded-md bg-primary-100 p-2">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">LinkedIn</span>
            </div>
          </div>
        </div>
        
                {/* Content Preview */}
        {data.textContent && (
          <div className="relative px-2">
            <div className="rounded-md bg-gray-50 p-2">
              <p className="text-xs text-gray-600 line-clamp-2">
                {data.textContent}
              </p>
            </div>
          </div>
        )}

        {/* Action Badge */}
        <div className="relative px-2">
          <div className="flex items-center justify-between text-xs">
            <span className="capitalize text-gray-500">
              {data.action}
            </span>
          </div>
        </div>
      </div>
      
      <NodeSourceHandle handleId="source" id={id} data={{ ...data, selected }} />
    </BaseNode>
  )
})

ProfessionalNetworkNode.displayName = 'ProfessionalNetworkNode'