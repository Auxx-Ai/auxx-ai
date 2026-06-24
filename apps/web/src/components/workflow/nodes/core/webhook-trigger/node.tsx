// apps/web/src/components/workflow/nodes/core/webhook-trigger/node.tsx

import { type FC, memo } from 'react'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { WebhookTriggerNode as WebhookTriggerNodeType } from './types'

/**
 * Connection Webhook trigger node. Shows the bound connection + topic in its
 * description once configured.
 */
export const WebhookTriggerNode: FC<WebhookTriggerNodeType> = memo((props) => {
  const { id, data, selected } = props

  const desc =
    data.connectionName && data.topic
      ? `${data.connectionName} · ${data.topic}`
      : 'Select a connection and topic'

  const displayData = { ...data, desc }

  return (
    <BaseNode id={id} data={displayData} selected={selected}>
      <NodeSourceHandle id={id} data={{ ...displayData, selected }} handleId='source' />
    </BaseNode>
  )
})

WebhookTriggerNode.displayName = 'WebhookTriggerNode'
