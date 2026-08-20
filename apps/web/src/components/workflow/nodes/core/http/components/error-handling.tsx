// apps/web/src/components/workflow/nodes/core/http/components/error-handling.tsx

'use client'

import { normalizeErrorStrategy } from '@auxx/lib/workflow-engine/client'
import { InputGroup, InputGroupAddon } from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputDecrement,
  NumberInputField,
  NumberInputIncrement,
  NumberInputScrubber,
} from '@auxx/ui/components/input-number'
import { useCallback } from 'react'
import { CodeEditor } from '~/components/schema-editor/ui/code-editor'
import {
  ErrorHandlingSection,
  type ErrorStrategyUpdate,
} from '~/components/workflow/nodes/shared/error-handling-section'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { type DefaultValueItem, ErrorStrategy, type HttpNodeData } from '../types'

interface ErrorHandlingProps {
  nodeId: string
  isReadOnly: boolean
  config: HttpNodeData
  onChange: (updates: Partial<HttpNodeData>) => void
}

/**
 * http's failure-policy panel.
 *
 * The strategy selector itself is the SHARED `ErrorHandlingSection`, driven by
 * `manifest.errorHandling.strategies` — this file used to own a bespoke
 * `<Select>` that duplicated crud's with different labels (plan 21 §15.4/§20.2).
 * What is left here is only the part that is genuinely http-specific: the
 * status/body/headers fields that make up the `default` substitute response.
 *
 * That defaults editor is deliberately NOT redesigned — plan 24 owns it.
 */
export function ErrorHandling({ nodeId, isReadOnly, config, onChange }: ErrorHandlingProps) {
  // Read through the normalizer: persisted http nodes carry `'none'`, the
  // legacy spelling of `continue` (plan 21 §15.1). The alias is never written
  // back.
  const errorStrategy = normalizeErrorStrategy(config?.error_strategy)

  // Helper function to get default value by key
  const getDefaultValue = (key: string): string => {
    const item = config?.default_value?.find((item: DefaultValueItem) => item.key === key)
    return item?.value || ''
  }

  // Helper function to update default value
  const updateDefaultValue = (key: string, value: string, type: string = 'string') => {
    const currentDefaults = config?.default_value || []
    const existingIndex = currentDefaults.findIndex((item: DefaultValueItem) => item.key === key)

    let newDefaults: DefaultValueItem[]
    if (existingIndex >= 0) {
      // Update existing value
      newDefaults = [...currentDefaults]
      newDefaults[existingIndex] = { key, type, value }
    } else {
      // Add new value
      newDefaults = [...currentDefaults, { key, type, value }]
    }

    onChange({ default_value: newDefaults })
  }

  const handleStrategyChange = useCallback(
    (update: ErrorStrategyUpdate) => onChange(update as Partial<HttpNodeData>),
    [onChange]
  )

  const handleStatusCodeChange = useCallback(
    (value: number | undefined) => {
      updateDefaultValue('status_code', (value ?? 200).toString(), 'number')
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: updateDefaultValue is intentionally used as dependency
    [updateDefaultValue]
  )

  const handleHeadersChange = useCallback(
    (value: string) => {
      updateDefaultValue('headers', value, 'object')
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: updateDefaultValue is intentionally used as dependency
    [updateDefaultValue]
  )

  const handleBodyChange = useCallback(
    (value: string) => {
      updateDefaultValue('body', value, 'string')
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: updateDefaultValue is intentionally used as dependency
    [updateDefaultValue]
  )

  return (
    <ErrorHandlingSection
      nodeId={nodeId}
      nodeType='http'
      errorStrategy={config?.error_strategy}
      onChange={handleStrategyChange}>
      {errorStrategy === ErrorStrategy.default && (
        <div className='space-y-3'>
          {/* Status Code */}
          <NumberInput
            value={parseInt(getDefaultValue('status_code'), 10) || 200}
            onValueChange={handleStatusCodeChange}
            min={100}
            max={599}
            step={1}
            disabled={isReadOnly}>
            <div className='flex flex-col gap-1'>
              <NumberInputScrubber htmlFor='status-code'>Status Code</NumberInputScrubber>
              <InputGroup>
                <InputGroupAddon align='inline-start'>
                  <NumberInputDecrement />
                </InputGroupAddon>
                <NumberInputField id='status-code' placeholder='200' />
                <InputGroupAddon align='inline-end'>
                  <NumberInputIncrement />
                </InputGroupAddon>
              </InputGroup>
            </div>
          </NumberInput>

          {/* Body */}
          <div className='flex flex-col gap-1'>
            <Editor
              title={<label className='text-xs'>Response Body</label>}
              value={getDefaultValue('body') || ''}
              onChange={handleBodyChange}
              nodeId={nodeId}
              placeholder='Enter default response body or use {{variables}}...'
              minHeight={100}
              readOnly={isReadOnly}
              trigger='{{'
            />
          </div>

          {/* Headers */}
          <div className='flex flex-col gap-1'>
            <label className='text-xs font-medium'>Response Headers</label>
            <CodeEditor
              value={getDefaultValue('headers') || '{}'}
              onUpdate={handleHeadersChange}
              readOnly={isReadOnly}
              className='h-[128px] rounded-md border border-primary-200'
              editorWrapperClassName='h-[100px]'
              hideTopMenu={false}
            />
          </div>
        </div>
      )}
    </ErrorHandlingSection>
  )
}
