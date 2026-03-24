// apps/web/src/components/workflow/nodes/core/list/components/unique-panel.tsx

'use client'

import type { FieldReference } from '@auxx/types/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import type React from 'react'
import { useMemo } from 'react'
import { NavigableFieldSelector } from '~/components/conditions/components/navigable-field-selector'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useFilterFieldResolver } from '../hooks/use-filter-field-resolver'
import { useUniqueConfig } from '../hooks/use-unique-config'
import type { ListNodeData, UniqueBy } from '../types'

interface UniquePanelProps {
  config: ListNodeData
  onChange: (updates: Partial<ListNodeData>) => void
  isReadOnly: boolean
  nodeId: string
}

/**
 * Unique operation configuration panel.
 * Primitive arrays: auto-dedup by value (no field selector).
 * Object arrays: field-based dedup with keep-first and case-sensitivity toggles.
 */
export const UniquePanel: React.FC<UniquePanelProps> = ({
  config,
  onChange,
  isReadOnly,
  nodeId,
}) => {
  const { fieldDefinitions, entityDefinitionId, isEmpty } = useFilterFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  const {
    by,
    field,
    keepFirst,
    caseSensitive,
    handleByChange,
    handleFieldSelect,
    handleKeepFirstChange,
    handleCaseSensitiveChange,
  } = useUniqueConfig(config, onChange)

  // Detect if the input is a primitive array (single _value field)
  const isPrimitive = useMemo(() => {
    return fieldDefinitions.length === 1 && fieldDefinitions[0].id === '_value'
  }, [fieldDefinitions])

  const hasFieldSelected = by === 'field' && !!field

  // Auto-set to 'whole' for primitive arrays
  if (!isEmpty && isPrimitive && by !== 'whole') {
    handleByChange('whole')
  }

  if (isEmpty) {
    return (
      <div className='text-center py-8 text-sm text-muted-foreground'>
        Select an array in "Input List" to configure deduplication
      </div>
    )
  }

  // Primitive array — simple message, no field selector
  if (isPrimitive) {
    return (
      <VarEditorField className='p-0'>
        <div className='p-3 text-sm text-muted-foreground'>
          Removes duplicate values from the list.
        </div>
        <VarEditorFieldRow title='Keep' type={BaseType.STRING} className='border-t'>
          <Select
            value={keepFirst ? 'first' : 'last'}
            onValueChange={(v) => handleKeepFirstChange(v === 'first')}
            disabled={isReadOnly}>
            <SelectTrigger variant='transparent' size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='first'>First occurrence</SelectItem>
              <SelectItem value='last'>Last occurrence</SelectItem>
            </SelectContent>
          </Select>
        </VarEditorFieldRow>
      </VarEditorField>
    )
  }

  // Object array — field selector + toggles
  return (
    <VarEditorField className='p-0'>
      {/* Mode + Field Selector */}
      <div className='flex items-center gap-2 p-2'>
        <div className='w-38'>
          <Select
            value={by}
            onValueChange={(v: string) => handleByChange(v as UniqueBy)}
            disabled={isReadOnly}>
            <SelectTrigger variant='outline' size='xs' className='w-auto shrink-0'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='whole'>Whole item</SelectItem>
              <SelectItem value='field'>By field</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {by === 'field' && entityDefinitionId && (
          <div className='flex-1 min-w-0'>
            <NavigableFieldSelector
              value={field as FieldReference | undefined}
              onSelect={handleFieldSelect}
              entityDefinitionId={entityDefinitionId}
              disabled={isReadOnly}
              placeholder='Select field'
            />
          </div>
        )}
      </div>

      {/* Keep First/Last toggle */}
      <VarEditorFieldRow title='Keep' type={BaseType.STRING} className='border-t'>
        <Select
          value={keepFirst ? 'first' : 'last'}
          onValueChange={(v) => handleKeepFirstChange(v === 'first')}
          disabled={isReadOnly}>
          <SelectTrigger variant='transparent' size='sm'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='first'>First occurrence</SelectItem>
            <SelectItem value='last'>Last occurrence</SelectItem>
          </SelectContent>
        </Select>
      </VarEditorFieldRow>

      {/* Case Sensitivity toggle — shown when a field is selected */}
      {hasFieldSelected && (
        <VarEditorFieldRow title='Case Sensitive' type={BaseType.BOOLEAN}>
          <div className='mt-2'>
            <Switch
              size='sm'
              checked={caseSensitive}
              onCheckedChange={handleCaseSensitiveChange}
              disabled={isReadOnly}
            />
          </div>
        </VarEditorFieldRow>
      )}
    </VarEditorField>
  )
}
