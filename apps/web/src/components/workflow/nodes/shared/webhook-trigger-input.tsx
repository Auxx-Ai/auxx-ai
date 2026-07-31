// apps/web/src/components/workflow/nodes/shared/webhook-trigger-input.tsx

import { useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import Field from '~/components/workflow/ui/field'
import Section from '~/components/workflow/ui/section'
import type { TriggerInputProps } from '../trigger-registry'

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
    <Section title='Webhook Trigger' initialOpen>
      <div className='space-y-4'>
        {/* Headers */}
        <Field title='Headers' description={headersDesc}>
          <CodeEditor
            language={CodeLanguage.json}
            value={formatValue(inputs.headers)}
            onChange={handleHeadersChange}
            readOnly={false}
            className='min-h-[100px]'
            minHeight={100}
          />
          {errors.headers && <p className='text-sm text-destructive'>{errors.headers}</p>}
        </Field>

        <Field title='Query Parameters' description={queryDesc}>
          <CodeEditor
            language={CodeLanguage.json}
            value={formatValue(inputs.query)}
            onChange={handleQueryChange}
            readOnly={false}
            className='min-h-[100px]'
            minHeight={100}
          />
          {errors.query && <p className='text-sm text-destructive'>{errors.query}</p>}
        </Field>
        {method === 'POST' && (
          <Field
            title='Request Body'
            description='Request body as JSON (can be object, array, or primitive)'>
            <CodeEditor
              language={CodeLanguage.json}
              value={formatValue(inputs.body)}
              onChange={handleBodyChange}
              readOnly={false}
              className='min-h-[100px]'
              minHeight={100}
            />
            {errors.body && <p className='text-sm text-destructive'>{errors.body}</p>}
          </Field>
        )}
      </div>
    </Section>
  )
}
