// apps/web/src/components/workflow/nodes/core/webhook/node.tsx

import { type FC, memo } from 'react'
import { type WebhookNode as WebhookNodeType } from './types'
import { BaseNode } from '../../shared/base/base-node'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { NodeResizer } from '~/components/workflow/ui/node-resizer'

/**
 * Webhook node component
 */
export const WebhookNode: FC<WebhookNodeType> = memo((props) => {
  const { id, data, selected } = props

  return (
    <BaseNode id={id} data={data} selected={selected}>
      <NodeSourceHandle id={id} data={{ ...data, selected }} handleId="source" />
      {/* <NodeResizer nodeId={id} selected={selected} /> */}
    </BaseNode>
  )
})

WebhookNode.displayName = 'WebhookNode'
