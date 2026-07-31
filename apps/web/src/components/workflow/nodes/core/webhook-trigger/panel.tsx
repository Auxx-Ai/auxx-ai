// apps/web/src/components/workflow/nodes/core/webhook-trigger/panel.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import React, { useMemo } from 'react'
import { WebhookEndpointInspector } from '~/components/webhooks/ui/webhook-endpoint-inspector'
import { WebhookTopicPicker } from '~/components/webhooks/ui/webhook-topic-picker'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import Field from '~/components/workflow/ui/field'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { api } from '~/trpc/react'
import { staticOutputVariableContext } from '../output-variable-context'
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
              <WebhookTopicPicker
                endpointId={nodeData.webhookEndpointId}
                value={nodeData.topic ? [nodeData.topic] : []}
                onChange={(keys) => handleTopicChange(keys[0] ?? '')}
                disabled={isReadOnly}
                placeholder={
                  selectedEndpoint?.topicSource ? 'Select or add a topic…' : 'All deliveries'
                }
              />
            </Field>
          )}
        </div>
      </Section>

      {nodeData.webhookEndpointId && (
        <WebhookEndpointInspector
          endpointId={nodeData.webhookEndpointId}
          topic={nodeData.topic}
          description='Live deliveries to this endpoint matching this trigger.'
        />
      )}

      <OutputVariablesDisplay
        outputVariables={
          webhookTriggerDefinition.outputVariables?.(
            nodeData,
            nodeId,
            staticOutputVariableContext
          ) || []
        }
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const WebhookTriggerPanel = React.memo(WebhookTriggerPanelComponent)
