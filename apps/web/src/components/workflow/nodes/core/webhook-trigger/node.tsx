// apps/web/src/components/workflow/nodes/core/webhook-trigger/node.tsx

import { type FC, memo } from 'react'
import type { NodeProps } from '~/components/workflow/types'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { WebhookTriggerNodeData } from './types'

/**
 * Webhook Endpoint trigger node. Shows the bound endpoint + topic in its
 * description once configured.
 */
export const WebhookTriggerNode: FC<NodeProps<WebhookTriggerNodeData>> = memo((props) => {
  const { id, data, selected } = props

  const desc = data.webhookEndpointName
    ? data.topic
      ? `${data.webhookEndpointName} · ${data.topic}`
      : data.webhookEndpointName
    : 'Select a webhook endpoint'

  const displayData = { ...data, desc }

  return (
    <BaseNode id={id} data={displayData} selected={selected}>
      <NodeSourceHandle id={id} data={{ ...displayData, selected }} handleId='source' />
    </BaseNode>
  )
})

WebhookTriggerNode.displayName = 'WebhookTriggerNode'
