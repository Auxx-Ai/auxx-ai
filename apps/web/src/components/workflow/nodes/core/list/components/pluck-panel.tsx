// apps/web/src/components/workflow/nodes/core/list/components/pluck-panel.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import type React from 'react'
import { useCallback } from 'react'
import type { FieldDefinition } from '~/components/conditions'
import { NavigableFieldSelector } from '~/components/conditions/components/navigable-field-selector'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useFilterFieldResolver } from '../hooks/use-filter-field-resolver'
import type { ListNodeData } from '../types'

interface PluckPanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Pluck operation configuration panel.
 * Extracts a specific field from each item in an array.
 * Uses NavigableFieldSelector for lazy drill-down into nested fields.
 */
export const PluckPanel: React.FC<PluckPanelProps> = ({ config, onChange, isReadOnly, nodeId }) => {
  const { entityDefinitionId, hasFields, isEmpty } = useFilterFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  const currentField = config.pluckConfig?.field
  const currentFlatten = config.pluckConfig?.flatten ?? false

  /** Handle field selection from NavigableFieldSelector */
  const handleFieldSelect = useCallback(
    (fieldReference: FieldReference, fieldDef: FieldDefinition) => {
      onChange({
        pluckConfig: {
          field: fieldReference as string | string[],
          flatten: fieldDef.type === BaseType.ARRAY ? currentFlatten : false,
        },
      })
    },
    [onChange, currentFlatten]
  )

  /** Handle flatten toggle */
  const handleFlattenChange = useCallback(
    (flatten: boolean) => {
      if (!currentField) return
      onChange({
        pluckConfig: {
          field: currentField,
          flatten,
        },
      })
    },
    [onChange, currentField]
  )

  // Show hint if no array selected
  if (isEmpty) {
    return (
      <div className='text-center py-8 text-sm text-muted-foreground'>
        Select an array in "Input List" to configure plucking
      </div>
    )
  }

  // No fields available (primitive array or unresolved)
  if (!hasFields || !entityDefinitionId) {
    return (
      <div className='rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center'>
        <div className='font-medium text-sm text-destructive'>No pluckable fields</div>
        <div className='text-xs mt-2 text-muted-foreground'>
          The selected array does not have any fields to pluck.
        </div>
      </div>
    )
  }

  return (
    <VarEditorField className='p-0'>
      {/* Field Selector */}
      <div className='p-2'>
        <NavigableFieldSelector
          value={currentField as FieldReference | undefined}
          onSelect={handleFieldSelect}
          entityDefinitionId={entityDefinitionId}
          disabled={isReadOnly}
          placeholder='Select field to pluck'
        />
      </div>

      {/* Flatten Toggle (shown when a field is selected) */}
      {currentField && (
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
      {currentField && (
        <div className='px-3 py-2 border-t bg-muted/30'>
          <div className='text-xs text-muted-foreground'>
            Extracts the selected field from each item
            {currentFlatten && <span className='text-amber-600'> (flattened)</span>}
          </div>
        </div>
      )}
    </VarEditorField>
  )
}
