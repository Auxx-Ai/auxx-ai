// apps/web/src/components/workflow/nodes/core/resource-trigger/node.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import type { NodeProps } from '@xyflow/react'
import { type FC, memo } from 'react'
import { NodeSourceHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { ResourceTriggerData } from './types'

/** Props for ResourceTriggerNode component */
interface ResourceTriggerNodeProps extends NodeProps {
  data: ResourceTriggerData
}

/**
 * Resource Trigger Node Component
 *
 * The single node type behind every resource trigger — the resource and the
 * operation come from its config, not from the node type. (The six legacy
 * per-resource types it used to also serve, `contact-created-trigger` …
 * `ticket-deleted-trigger`, were retired: never implemented, no persisted
 * graphs.)
 */
const ResourceTriggerNodeComponent: FC<ResourceTriggerNodeProps> = ({ id, data, selected }) => {
  // console.log('Rendering ResourceTriggerNode:', id, data, selected)
  return (
    <BaseNode id={id} data={data} selected={selected} className='rounded-tl-none!'>
      <NodeSourceHandle id={id} data={{ ...data, selected }} handleId='source' />
      <div
        className={cn(
          'z-3 absolute top-[-24px] left-[-1px] rounded-t-md border-t border-x text-xs text-muted-foreground bg-secondary px-2 py-1',
          selected &&
            'after:inset-[-2px] after:bottom-[1px] after:absolute after:rounded-t-md after:border-t after:border-x after:border-secondary after:z-[-1] after:border-info after:border-b-0! after:border-2 '
        )}>
        Trigger
      </div>
    </BaseNode>
  )
}

export const ResourceTriggerNode = memo(ResourceTriggerNodeComponent)
