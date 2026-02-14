// apps/web/src/components/workflow/nodes/core/list/components/sort-panel.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type React from 'react'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useSortConfig } from '../hooks/use-sort-config'
import { useSortFieldResolver } from '../hooks/use-sort-field-resolver'
import type { ListNodeData } from '../types'

interface SortPanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Sort operation configuration panel with dynamic field detection.
 * Supports sorting by relation subfields (e.g., "contact.name").
 */
export const SortPanel: React.FC<SortPanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  // Get sortable fields from the array variable (includes relation subfields)
  const { sortableFields, hasSortableFields, isEmpty } = useSortFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  // Manage sort state
  const {
    currentField,
    currentDirection,
    nullHandling,
    handleFieldChange,
    handleDirectionChange,
    handleNullHandlingChange,
  } = useSortConfig(config, onChange)

  // Show hint if no array selected
  if (isEmpty) {
    return (
      <div className='text-center py-8 text-sm text-muted-foreground'>
        Select an array in "Input List" to configure sorting
      </div>
    )
  }

  // Error state: array has no sortable fields
  if (!hasSortableFields) {
    return (
      <div className='rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center'>
        <div className='font-medium text-sm text-destructive'>No sortable fields</div>
        <div className='text-xs mt-2 text-muted-foreground'>
          The selected array does not have any sortable fields.
          <br />
          Sortable types: String, Number, Date, Boolean, Enum
        </div>
      </div>
    )
  }

  // Find the currently selected field definition for display
  const selectedField = sortableFields.find((f) => f.id === currentField)

  return (
    <VarEditorField className='p-0'>
      <div className='flex gap-2 p-1 '>
        {/* Field Selector */}
        <Select
          value={currentField || 'none'}
          onValueChange={handleFieldChange}
          disabled={isReadOnly}>
          <SelectTrigger className='flex-1' variant='transparent' size='xs'>
            <SelectValue placeholder='Select field' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='none'>No sorting</SelectItem>
            {sortableFields.map((field) => (
              <SelectItem key={field.id} value={field.id}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Direction Selector */}
        <Select
          value={currentDirection}
          onValueChange={handleDirectionChange}
          disabled={isReadOnly || !currentField}>
          <SelectTrigger className='w-24' variant='outline' size='xs'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='asc'>ASC</SelectItem>
            <SelectItem value='desc'>DESC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {currentField && (
        <VarEditorFieldRow title='Null Handling' type={BaseType.STRING} className='border-t'>
          <Select
            value={nullHandling || 'last'}
            onValueChange={handleNullHandlingChange}
            disabled={isReadOnly}>
            <SelectTrigger variant='transparent' size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='first'>Nulls First</SelectItem>
              <SelectItem value='last'>Nulls Last</SelectItem>
            </SelectContent>
          </Select>
        </VarEditorFieldRow>
      )}
    </VarEditorField>
  )
}
