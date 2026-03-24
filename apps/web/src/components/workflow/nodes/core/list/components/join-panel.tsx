// apps/web/src/components/workflow/nodes/core/list/components/join-panel.tsx

'use client'

import { BaseType } from '@auxx/lib/workflow-engine/client'
import { Input } from '@auxx/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type React from 'react'
import { useState } from 'react'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { usePluckFieldResolver } from '../hooks/use-pluck-field-resolver'
import type { ListNodeData } from '../types'

interface JoinPanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/** Common delimiter presets */
const DELIMITER_PRESETS = [
  { value: ', ', label: 'Comma + Space', display: ', ' },
  { value: ',', label: 'Comma', display: ',' },
  { value: '\n', label: 'New Line', display: '\\n' },
  { value: ' ', label: 'Space', display: '␣' },
  { value: ' | ', label: 'Pipe', display: ' | ' },
  { value: ' - ', label: 'Dash', display: ' - ' },
  { value: 'custom', label: 'Custom...', display: '' },
]

/**
 * Join operation configuration panel.
 * Converts an array to a string by joining elements with a delimiter.
 */
export const JoinPanel: React.FC<JoinPanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  const joinConfig = config.joinConfig || { delimiter: ', ' }
  const currentDelimiter = joinConfig.delimiter
  const currentField = joinConfig.field

  // Check if current delimiter matches a preset
  const matchesPreset = DELIMITER_PRESETS.some(
    (p) => p.value === currentDelimiter && p.value !== 'custom'
  )

  // Track if user explicitly selected custom mode
  const [isCustomMode, setIsCustomMode] = useState(!matchesPreset)
  const selectValue = isCustomMode ? 'custom' : currentDelimiter

  // Get pluckable fields if input is an object array
  const { pluckableFields, hasPluckableFields } = usePluckFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  // Exclude structural types that don't have a meaningful string representation
  const NON_JOINABLE_TYPES = new Set([
    BaseType.OBJECT,
    BaseType.ARRAY,
    BaseType.RELATION,
    BaseType.REFERENCE,
    BaseType.FILE,
    BaseType.JSON,
  ])
  const joinableFields = pluckableFields.filter((f) => !NON_JOINABLE_TYPES.has(f.type))

  /**
   * Handle delimiter preset selection
   */
  const handleDelimiterPresetChange = (value: string) => {
    if (value === 'custom') {
      setIsCustomMode(true)
      return
    }
    setIsCustomMode(false)
    onChange({
      joinConfig: { ...joinConfig, delimiter: value },
    })
  }

  /**
   * Handle custom delimiter input
   */
  const handleCustomDelimiterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      joinConfig: { ...joinConfig, delimiter: e.target.value },
    })
  }

  /**
   * Handle field selection for object arrays
   */
  const handleFieldChange = (field: string) => {
    onChange({
      joinConfig: {
        ...joinConfig,
        field: field === 'none' ? undefined : field,
      },
    })
  }

  return (
    <VarEditorField className='p-0'>
      {/* Delimiter Selector */}
      <div className='p-2 space-y-2'>
        <div className='flex gap-2'>
          <Select
            value={selectValue}
            onValueChange={handleDelimiterPresetChange}
            disabled={isReadOnly}>
            <SelectTrigger className='w-40' size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIMITER_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  <div className='flex items-center gap-2'>
                    <span>{preset.label}</span>
                    {preset.display && (
                      <code className='text-xs bg-muted px-1 rounded'>{preset.display}</code>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Custom delimiter input */}
          {isCustomMode && (
            <Input
              value={currentDelimiter}
              size='sm'
              variant='transparent'
              onChange={handleCustomDelimiterChange}
              placeholder='Enter delimiter'
              disabled={isReadOnly}
              className='flex-1'
            />
          )}
        </div>
      </div>

      {/* Field Selector (only for object arrays) */}
      {hasPluckableFields && joinableFields.length > 0 && (
        <VarEditorFieldRow title='Field to Join' className='border-t'>
          <div className='flex items-center  h-8'>
            <Select
              value={currentField || 'none'}
              onValueChange={handleFieldChange}
              disabled={isReadOnly}>
              <SelectTrigger className='w-full' variant='transparent' size='xs'>
                <SelectValue placeholder='Use whole item' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>
                  <span className='text-muted-foreground'>Use whole item</span>
                </SelectItem>
                {joinableFields.map((field) => (
                  <SelectItem key={field.id} value={field.id}>
                    <div className='flex items-center gap-1.5'>
                      <VarTypeIcon type={field.type} className='size-3' />
                      <span>{field.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </VarEditorFieldRow>
      )}

      {/* Preview hint */}
      <div className='px-3 py-2 border-t bg-muted/30'>
        <div className='text-xs text-muted-foreground'>
          <div>
            Joins all items with "
            <code className='bg-background px-1 rounded'>
              {currentDelimiter === '\n' ? '\\n' : currentDelimiter}
            </code>
            "
            {currentField && (
              <span>
                {' '}
                using{' '}
                <span className='font-medium'>
                  {joinableFields.find((f) => f.id === currentField)?.label ?? currentField}
                </span>{' '}
                field
              </span>
            )}
          </div>
        </div>
      </div>
    </VarEditorField>
  )
}
