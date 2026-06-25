// apps/web/src/components/workflow/nodes/core/webhook-trigger/panel.tsx

'use client'

import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import React, { useMemo } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import Field from '~/components/workflow/ui/field'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { api } from '~/trpc/react'
import { webhookTriggerDefinition } from './schema'
import type { WebhookTriggerNodeData } from './types'

interface WebhookTriggerPanelProps {
  nodeId: string
  data: WebhookTriggerNodeData
}

/**
 * Configuration panel for the webhook endpoint trigger node — pick a generic inbound
 * `WebhookEndpoint` (via `webhookEndpoint.list`) and optionally a topic to scope
 * deliveries. Caches the endpoint's display name onto the node so the node label + save
 * path don't re-query.
 */
const WebhookTriggerPanelComponent: React.FC<WebhookTriggerPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<WebhookTriggerNodeData>(
    nodeId,
    data
  )

  const { data: endpoints = [] } = api.webhookEndpoint.list.useQuery()

  const selectedEndpoint = useMemo(
    () => endpoints.find((e) => e.id === nodeData.webhookEndpointId) ?? null,
    [endpoints, nodeData.webhookEndpointId]
  )

  const handleEndpointChange = (webhookEndpointId: string) => {
    const endpoint = endpoints.find((e) => e.id === webhookEndpointId)
    setNodeData({
      ...nodeData,
      webhookEndpointId,
      webhookEndpointName: endpoint?.name,
      title: endpoint ? `Webhook · ${endpoint.name}` : 'Webhook Endpoint',
    })
  }

  const handleTopicChange = (topic: string) => {
    setNodeData({ ...nodeData, topic })
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section
        title='Webhook endpoint'
        description='Fire this workflow on a webhook endpoint delivery.'
        isRequired>
        <div className='space-y-4'>
          <Field title='Endpoint' description='Inbound webhook endpoints in this workspace.'>
            <Select
              value={nodeData.webhookEndpointId || undefined}
              onValueChange={handleEndpointChange}
              disabled={isReadOnly}>
              <SelectTrigger className='w-full' size='sm'>
                <SelectValue placeholder='Select an endpoint...' />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {nodeData.webhookEndpointId && (
            <Field
              title='Topic'
              description={
                selectedEndpoint?.topicSource
                  ? 'Only fire on deliveries whose extracted topic matches.'
                  : 'Optional — leave blank to fire on every delivery.'
              }>
              <Input
                value={nodeData.topic}
                onChange={(e) => handleTopicChange(e.target.value)}
                placeholder={
                  selectedEndpoint?.topicSource
                    ? 'e.g. payment_intent.succeeded'
                    : 'Leave blank for all'
                }
                disabled={isReadOnly}
              />
            </Field>
          )}
        </div>
      </Section>

      <OutputVariablesDisplay
        outputVariables={webhookTriggerDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const WebhookTriggerPanel = React.memo(WebhookTriggerPanelComponent)
