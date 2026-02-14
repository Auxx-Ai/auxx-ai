// apps/web/src/components/workflow/nodes/core/http/components/error-handling.tsx

'use client'

import { InputGroup, InputGroupAddon } from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputDecrement,
  NumberInputField,
  NumberInputIncrement,
  NumberInputScrubber,
} from '@auxx/ui/components/input-number'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useCallback } from 'react'
import { useEdgeInteractions } from '~/components/workflow/hooks'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import Section from '~/components/workflow/ui/section'
import CodeEditor from '~/components/workflow/ui/structured-output-generator/code-editor'
import { type DefaultValueItem, ErrorStrategy, type HttpNodeData } from '../types'

interface ErrorHandlingProps {
  nodeId: string
  isReadOnly: boolean
  config: HttpNodeData
  onChange: (updates: Partial<HttpNodeData>) => void
}

export function ErrorHandling({ nodeId, isReadOnly, config, onChange }: ErrorHandlingProps) {
  const { handleEdgeDeleteByDeleteBranch } = useEdgeInteractions()

  // Use direct state for error strategy
  const errorStrategy = config?.error_strategy

  // Handle error strategy change and update target branches
  const setErrorStrategy = (newStrategy: string) => {
    const branches =
      newStrategy === ErrorStrategy.fail
        ? [
            { id: 'source', name: '', type: 'default' as const },
            { id: 'fail', name: 'Fail Branch', type: 'fail' as const },
          ]
        : [{ id: 'source', name: '', type: 'default' as const }]

    onChange({ error_strategy: newStrategy, _targetBranches: branches })

    // If changing from fail to something else, delete the fail branch edges
    if (errorStrategy === ErrorStrategy.fail && newStrategy !== ErrorStrategy.fail) {
      handleEdgeDeleteByDeleteBranch(nodeId, 'fail')
    }
  }

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
    <Section
      title='Error handling'
      initialOpen={errorStrategy !== ErrorStrategy.none}
      enabled={errorStrategy !== ErrorStrategy.none}
      actions={
        <Select
          value={errorStrategy || 'default'}
          onValueChange={setErrorStrategy}
          disabled={isReadOnly}>
          <SelectTrigger variant='default' size='sm' className='mb-0'>
            <SelectValue placeholder='Select strategy' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ErrorStrategy.none}>None</SelectItem>
            <SelectItem value={ErrorStrategy.default}>Default Values</SelectItem>
            <SelectItem value={ErrorStrategy.fail}>Fail branch</SelectItem>
          </SelectContent>
        </Select>
      }>
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
            />
          </div>

          {/* Headers */}
          <div className='flex flex-col gap-1'>
            <label className='text-xs font-medium'>Response Headers</label>
            <CodeEditor
              value={getDefaultValue('headers') || '{}'}
              onUpdate={handleHeadersChange}
              readOnly={isReadOnly}
              className='min-h-[100px] rounded-md border border-primary-200'
              editorWrapperClassName='h-[100px]'
              hideTopMenu={false}
            />
          </div>
        </div>
      )}
      {errorStrategy === ErrorStrategy.fail && (
        <div className='text-sm text-primary-500'>Configure a 'Fail branch' below.</div>
      )}
    </Section>
  )
}
