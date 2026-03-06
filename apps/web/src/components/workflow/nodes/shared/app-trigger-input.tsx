// apps/web/src/components/workflow/nodes/shared/app-trigger-input.tsx

'use client'

import { useCallback } from 'react'
import { CodeEditor } from '~/components/workflow/ui/code-editor'
import { CodeLanguage } from '~/components/workflow/ui/code-editor/types'
import Field from '~/components/workflow/ui/field'
import Section from '~/components/workflow/ui/section'
import type { TriggerInputProps } from '../trigger-registry'

/**
 * App trigger input component for the Run panel's Input tab.
 * Renders a JSON editor pre-filled with sample data from the trigger's schema outputs.
 */
export function AppTriggerInput({ inputs, errors, onChange }: TriggerInputProps) {
  const handleChange = useCallback(
    (value: string) => {
      onChange('triggerData', value)
    },
    [onChange]
  )

  const value =
    typeof inputs.triggerData === 'string'
      ? inputs.triggerData
      : JSON.stringify(inputs.triggerData ?? {}, null, 2)

  return (
    <Section title='Trigger Data' initialOpen>
      <Field
        title='Test Payload'
        description='JSON data to simulate the trigger event. This will be passed to your workflow as trigger data.'>
        <CodeEditor
          value={value}
          onChange={handleChange}
          language={CodeLanguage.json}
          readOnly={false}
          minHeight={150}
          height={200}
        />
        {errors.triggerData && <p className='text-sm text-destructive'>{errors.triggerData}</p>}
      </Field>
    </Section>
  )
}
