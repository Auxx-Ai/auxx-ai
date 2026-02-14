// apps/web/src/components/workflow/nodes/core/list/components/pluck-panel.tsx

'use client'

import { BaseType } from '@auxx/lib/workflow-engine/client'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import type React from 'react'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'
import { getFieldDisplayType } from '~/components/workflow/utils/variable-utils'
import { usePluckConfig } from '../hooks/use-pluck-config'
import { usePluckFieldResolver } from '../hooks/use-pluck-field-resolver'
import type { ListNodeData } from '../types'

interface PluckPanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Pluck operation configuration panel with dynamic field detection.
 * Supports ALL field types and deep nested paths (e.g., "contact.createdBy.firstName").
 */
export const PluckPanel: React.FC<PluckPanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  // Get pluckable fields from the array variable (includes all nested fields)
  const { pluckableFields, hasPluckableFields, isEmpty } = usePluckFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  // Manage pluck state
  const { currentField, currentFlatten, handleFieldChange, handleFlattenChange } = usePluckConfig(
    config,
    onChange
  )

  // Show hint if no array selected
  if (isEmpty) {
    return (
      <div className='text-center py-8 text-sm text-muted-foreground'>
        Select an array in "Input List" to configure plucking
      </div>
    )
  }

  // Error state: array has no pluckable fields
  if (!hasPluckableFields) {
    return (
      <div className='rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center'>
        <div className='font-medium text-sm text-destructive'>No pluckable fields</div>
        <div className='text-xs mt-2 text-muted-foreground'>
          The selected array does not have any fields to pluck.
        </div>
      </div>
    )
  }

  // Find the currently selected field definition
  const selectedField = pluckableFields.find((f) => f.id === currentField)
  const selectedFieldIsArray = selectedField?.type === BaseType.ARRAY

  return (
    <VarEditorField className='p-0'>
      {/* Field Selector */}
      <div className='p-1'>
        <Select
          value={currentField || 'none'}
          onValueChange={handleFieldChange}
          disabled={isReadOnly}>
          <SelectTrigger className='w-full' variant='transparent' size='xs'>
            <SelectValue placeholder='Select field to pluck' />
          </SelectTrigger>
          <SelectContent className='max-h-[300px]'>
            <SelectItem value='none'>
              <span className='text-muted-foreground'>No plucking</span>
            </SelectItem>
            {pluckableFields.map((field) => (
              <SelectItem key={field.id} value={field.id} className='ps-1.5'>
                <div className='flex items-center gap-1.5 p-[1px]'>
                  <div className='rounded-full ring-1 ring-ring bg-secondary flex items-center justify-center size-4'>
                    <VarTypeIcon type={field.type} className='size-3' />
                  </div>
                  <span>{field.label}</span>
                  {field.id.includes('.') && (
                    <span className='text-xs text-muted-foreground ml-auto'>
                      {field.id.split('.').length} levels
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Flatten Toggle (only for ARRAY fields) */}
      {currentField && selectedFieldIsArray && (
        <VarEditorFieldRow title='Flatten Results' className='border-t'>
          <div className='flex items-center gap-2'>
            <Switch
              checked={currentFlatten}
              onCheckedChange={handleFlattenChange}
              disabled={isReadOnly}
            />
            <Label className='text-xs text-muted-foreground cursor-pointer'>
              Flatten nested arrays into a single array
            </Label>
          </div>
        </VarEditorFieldRow>
      )}

      {/* Info hint */}
      {currentField && selectedField && (
        <div className='px-3 py-2 border-t bg-muted/30'>
          <div className='text-xs text-muted-foreground'>
            <div className='flex items-center gap-2 mb-1'>
              <span className='font-medium'>Output:</span>
              <code className='bg-background px-1 rounded text-[10px]'>
                {getFieldDisplayType(selectedField)}[]
              </code>
            </div>
            <div>
              Extracts <span className='font-medium'>{selectedField.label}</span> from each item
              {selectedFieldIsArray && currentFlatten && (
                <span className='text-amber-600'> (flattened)</span>
              )}
            </div>
          </div>
        </div>
      )}
    </VarEditorField>
  )
}
