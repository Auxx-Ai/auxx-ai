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
import { ConnectionPickerPopover } from '~/components/apps/ui/connection-picker-popover'
import { ConnectionWebhookTestSection } from '~/components/connections/triggers/connection-webhook-test-section'
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
 * Configuration panel for the connection webhook trigger node — pick a connection
 * (spec-bearing providers only, via `connections.webhookConnections`) and one of its
 * topics. Caches the connection's display fields onto the node so the node label +
 * save path don't re-query. When configured, embeds the §7.2 delivery inspector so the
 * author can watch live/test deliveries on the selected topic.
 */
const WebhookTriggerPanelComponent: React.FC<WebhookTriggerPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<WebhookTriggerNodeData>(
    nodeId,
    data
  )

  // Spec-bearing connections only — the allow-list for the picker + the topic source.
  const { data: connections = [] } = api.connections.webhookConnections.useQuery()
  const webhookCapableIds = useMemo(() => connections.map((c) => c.id), [connections])

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === nodeData.connectionId) ?? null,
    [connections, nodeData.connectionId]
  )
  const availableTopics = selectedConnection?.topics ?? []

  const handleConnectionChange = (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId)
    setNodeData({
      ...nodeData,
      connectionId,
      connectionName: conn?.name,
      connectionType: conn?.type,
      connectionIcon: conn?.icon ?? undefined,
      // Reset the topic — it belongs to the previous connection.
      topic: '',
      title: conn ? `Connection Webhook · ${conn.name}` : 'Connection Webhook',
    })
  }

  const handleTopicChange = (topic: string) => {
    setNodeData({ ...nodeData, topic })
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      <Section
        title='Connection'
        description='Fire this workflow on a connection webhook.'
        isRequired>
        <div className='space-y-4'>
          <Field title='Connection' description='Only connections with webhook support are listed.'>
            <ConnectionPickerPopover
              value={nodeData.connectionId || undefined}
              onPick={(credentialId) => handleConnectionChange(credentialId)}
              filterCredentialIds={webhookCapableIds}
              orgScopedOnly={false}
              matchTriggerWidth
              enableActions={false}
              placeholder='Select a connection...'
            />
          </Field>

          {nodeData.connectionId && (
            <Field title='Topic' description='The provider event that fires this workflow.'>
              <Select
                value={nodeData.topic || undefined}
                onValueChange={handleTopicChange}
                disabled={isReadOnly}>
                <SelectTrigger className='w-full' size='sm'>
                  <SelectValue placeholder='Select a topic...' />
                </SelectTrigger>
                <SelectContent>
                  {availableTopics.map((topic) => (
                    <SelectItem key={topic} value={topic}>
                      {topic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
      </Section>

      {nodeData.connectionId && nodeData.topic && (
        <ConnectionWebhookTestSection connectionId={nodeData.connectionId} topic={nodeData.topic} />
      )}

      <OutputVariablesDisplay
        outputVariables={webhookTriggerDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const WebhookTriggerPanel = React.memo(WebhookTriggerPanelComponent)
