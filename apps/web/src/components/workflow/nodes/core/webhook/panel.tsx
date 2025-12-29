// apps/web/src/components/workflow/nodes/core/webhook/panel.tsx

'use client'

import React, { useState, useEffect } from 'react'
import { type WebhookNodeData } from './types'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Button } from '@auxx/ui/components/button'
import { Copy, FileJson, Trash2 } from 'lucide-react'
import Section from '~/components/workflow/ui/section'
import { useNodeCrud, useWebhookTestListener, useReadOnly } from '~/components/workflow/hooks'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { toastSuccess } from '@auxx/ui/components/toast'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { webhookDefinition } from './schema'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { WebhookTestEvents } from './webhook-test-events'
import StructuredOutputGenerator from '~/components/workflow/ui/structured-output-generator'
import { jsonToSchema } from '~/components/workflow/utils/schema-to-variable'
import type { SchemaRoot } from '~/components/workflow/ui/structured-output-generator/types'
import { produce } from 'immer'

interface WebhookPanelProps {
  nodeId: string
  data: WebhookNodeData
}

/**
 * Configuration panel for webhook node
 */
const WebhookPanelComponent: React.FC<WebhookPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const metadata = useWorkflowStore((state) => state.metadata)
  const workflowId = metadata?.id || ''
  const [urlType, setUrlType] = useState<'test' | 'production'>('test')
  const [isSchemaEditorOpen, setIsSchemaEditorOpen] = useState(false)
  const [selectedEventBody, setSelectedEventBody] = useState<any>(null)

  // if (!data) return null

  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<WebhookNodeData>(nodeId, data)

  // Use webhook test listener hook
  const { events, isListening, connectionStatus, startListening, stopListening, clearEvents } =
    useWebhookTestListener(workflowId)

  // Generate webhook URLs
  const baseWebhookUrl = `${window.location.origin}/api/workflows/${workflowId}/webhook`
  const productionUrl = baseWebhookUrl
  const testUrl = `${baseWebhookUrl}?test=true`

  // Get current URL based on selected type
  const currentUrl = urlType === 'production' ? productionUrl : testUrl

  const handleMethodChange = (value: 'GET' | 'POST') => {
    setNodeData({ ...nodeData, method: value })
  }

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(currentUrl)
    toastSuccess({
      title: 'Webhook URL copied',
      description: `${urlType === 'production' ? 'Production' : 'Test'} URL copied to clipboard`,
    })
  }

  const handleUseAsSchemaTemplate = (eventBody: any) => {
    setSelectedEventBody(eventBody)
    setIsSchemaEditorOpen(true)
  }

  const handleSaveSchema = (schema: SchemaRoot) => {
    const newData = produce(nodeData, (draft) => {
      draft.bodySchema = { enabled: true, schema: schema }
    })
    setNodeData(newData)
    setIsSchemaEditorOpen(false)
    setSelectedEventBody(null)
    toastSuccess({
      title: 'Body schema saved',
      description: 'The webhook body schema has been configured',
    })
  }

  const handleEditSchema = () => {
    setSelectedEventBody(null)
    setIsSchemaEditorOpen(true)
  }

  const handleRemoveSchema = () => {
    const newData = produce(nodeData, (draft) => {
      draft.bodySchema = { enabled: false, schema: undefined }
    })
    setNodeData(newData)
    toastSuccess({
      title: 'Body schema removed',
      description: 'The webhook body schema has been removed',
    })
  }

  // Stop listening when component unmounts or URL type changes to production
  useEffect(() => {
    if (urlType === 'production' && isListening) {
      stopListening()
    }
  }, [urlType, isListening, stopListening])

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Webhook URL Section */}
      <Section
        title="Webhook URL"
        description="Use this URL to trigger your workflow."
        isRequired
        actions={
          <Select
            value={urlType}
            onValueChange={(value: 'test' | 'production') => setUrlType(value)}>
            <SelectTrigger className="w-25" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">Test</SelectItem>
              <SelectItem value="production">Production</SelectItem>
            </SelectContent>
          </Select>
        }>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <InputGroup className="flex-1">
              <InputGroupAddon align="inline-start">
                <Select
                  value={nodeData.method || 'POST'}
                  onValueChange={handleMethodChange}
                  disabled={isReadOnly}>
                  <SelectTrigger id="method" variant="transparent" className="w-20 h-auto border-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                  </SelectContent>
                </Select>
              </InputGroupAddon>

              <InputGroupInput type="text" value={currentUrl} readOnly className="font-mono text-xs" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" onClick={copyWebhookUrl} aria-label="Copy webhook URL">
                  <Copy />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {urlType === 'test'
                ? 'Test mode uses the draft version of your workflow'
                : 'Production mode uses the published version of your workflow'}
            </p>
            {urlType === 'test' && (
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'ms-2 border w-25',
                  isListening &&
                    'bg-bad-200 hover:bg-bad-200 text-bad-500 hover:text-bad-500 border-bad-300'
                )}
                loading={isListening}
                loadingText="Listening..."
                disabled={isReadOnly}
                onClick={() => (isListening ? stopListening() : startListening())}>
                {isListening ? 'Stop Listening' : 'Test Webhook'}
              </Button>
            )}
          </div>
        </div>

        {isListening && (
          <WebhookTestEvents
            events={events}
            onClear={clearEvents}
            onUseAsSchema={handleUseAsSchemaTemplate}
          />
        )}
      </Section>
      {/* Test Event Listener */}
      {/* {isListening && (
        <Section
          title="Test Webhook Events"
          description="Incoming webhook events will appear here in real-time."
          initialOpen={true}
          actions={
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'connecting'
                      ? 'bg-yellow-500 animate-pulse'
                      : 'bg-gray-400'
                )}
              />
              <span className="text-xs text-muted-foreground">
                {connectionStatus === 'connected'
                  ? 'Listening'
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : 'Disconnected'}
              </span>
            </div>
          }></Section>
      )} */}

      {/* Body Schema Configuration (for POST) */}
      {nodeData.method === 'POST' && (
        <Section
          title="Request Body Schema"
          description="Define the expected body structure for validation and output variables."
          initialOpen={nodeData.bodySchema?.enabled}
          actions={
            nodeData.bodySchema?.enabled && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleEditSchema} disabled={isReadOnly}>
                  <FileJson className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveSchema}
                  disabled={isReadOnly}>
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            )
          }>
          <div className="space-y-4">
            {nodeData.bodySchema?.enabled && nodeData.bodySchema?.schema ? (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  <p>
                    Schema is configured. The webhook will validate incoming requests against this
                    schema.
                  </p>
                </div>
                <div className="bg-muted p-3 rounded-md">
                  <pre className="text-xs overflow-x-auto">
                    {JSON.stringify(nodeData.bodySchema.schema, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>
                  No body schema configured. Send a test webhook with a JSON body, then click "Use
                  as Schema Template" to generate a schema.
                </p>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Available Variables */}
      <OutputVariablesDisplay
        outputVariables={webhookDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />

      {/* Schema Editor Dialog */}
      <StructuredOutputGenerator
        isShow={isSchemaEditorOpen}
        defaultSchema={
          selectedEventBody ? jsonToSchema(selectedEventBody) : nodeData.bodySchema?.schema
        }
        onSave={handleSaveSchema}
        onClose={() => {
          setIsSchemaEditorOpen(false)
          setSelectedEventBody(null)
        }}
      />
    </BasePanel>
  )
}

export const WebhookPanel = React.memo(WebhookPanelComponent)
