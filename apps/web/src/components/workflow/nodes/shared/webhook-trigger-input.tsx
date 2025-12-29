// apps/web/src/components/workflow/nodes/shared/webhook-trigger-input.tsx

import React, { useCallback } from 'react'
import { CodeEditor } from '~/components/workflow/ui/code-editor'
import { useStoreApi } from '@xyflow/react'
import type { TriggerInputProps } from '../trigger-registry'
import Field from '~/components/workflow/ui/field'
import Section from '~/components/workflow/ui/section'

/**
 * Webhook trigger input component for test mode
 * Allows users to specify headers, query parameters, and request body
 */
export function WebhookTriggerInput({ inputs, errors, onChange }: TriggerInputProps) {
  const store = useStoreApi()
  // Get the webhook node to determine the method
  // const webhookNode = store
  //   .getState()
  //   .nodes.find((node) => node.data.type === WorkflowNodeType.WEBHOOK)
  const webhookNode = { data: { method: 'POST' } }
  const method = webhookNode?.data?.method || 'GET'

  const handleHeadersChange = useCallback(
    (value: string) => {
      try {
        const parsed = JSON.parse(value || '{}')
        onChange('headers', parsed)
      } catch (error) {
        // Keep the string value if it's not valid JSON
        onChange('headers', value)
      }
    },
    [onChange]
  )

  const handleQueryChange = useCallback(
    (value: string) => {
      try {
        const parsed = JSON.parse(value || '{}')
        onChange('query', parsed)
      } catch (error) {
        // Keep the string value if it's not valid JSON
        onChange('query', value)
      }
    },
    [onChange]
  )

  const handleBodyChange = useCallback(
    (value: string) => {
      try {
        const parsed = JSON.parse(value || '{}')
        onChange('body', parsed)
      } catch (error) {
        // Keep the string value if it's not valid JSON
        onChange('body', value)
      }
    },
    [onChange]
  )

  // Format values for display
  const formatValue = (value: any): string => {
    if (typeof value === 'string') {
      return value
    }
    return JSON.stringify(value || {}, null, 2)
  }

  const headersDesc = 'HTTP headers as JSON object (e.g., {"Content-Type": "application/json"})'
  const queryDesc =
    'Query parameters as JSON object (e.g., {"param1": "value1", "param2": "value2"})'

  return (
    <Section title="Webhook Trigger" initialOpen>
      <div className="space-y-4">
        {/* Headers */}
        <Field title="Headers" description={headersDesc}>
          <CodeEditor
            value={formatValue(inputs.headers)}
            onChange={handleHeadersChange}
            readOnly={false}
            className="min-h-[100px]"
            editorWrapperClassName="h-[100px]"
            hideTopMenu={false}
          />
          {errors.headers && <p className="text-sm text-destructive">{errors.headers}</p>}
        </Field>

        <Field title="Query Parameters" description={queryDesc}>
          <CodeEditor
            value={formatValue(inputs.query)}
            onChange={handleQueryChange}
            readOnly={false}
            className="min-h-[100px]"
            editorWrapperClassName="h-[100px]"
            hideTopMenu={false}
          />
          {errors.query && <p className="text-sm text-destructive">{errors.query}</p>}
        </Field>
        {method === 'POST' && (
          <Field
            title="Request Body"
            description="Request body as JSON (can be object, array, or primitive)">
            <CodeEditor
              value={formatValue(inputs.body)}
              onChange={handleBodyChange}
              readOnly={false}
              className="min-h-[100px]"
              editorWrapperClassName="h-[100px]"
              hideTopMenu={false}
            />
            {errors.body && <p className="text-sm text-destructive">{errors.body}</p>}
          </Field>
        )}
      </div>
    </Section>
  )
}
