// apps/web/src/components/pickers/field-picker/field-item.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { CommandItem } from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Check, ChevronRight } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useResourceProperty } from '~/components/resources'
import type { FieldItemProps } from './types'

/**
 * Individual field item in the resource picker.
 * Shows appropriate icon based on field type:
 * - Relationship fields: target resource's icon
 * - Regular fields: fieldType icon from fieldTypeOptions
 */
export const FieldItem = memo(function FieldItem({
  field,
  isSelected,
  canDrillDown,
  onSelect,
  onDrillDown,
}: FieldItemProps) {
  const isRelationship = !!field.relationship

  // Derive relatedEntityDefinitionId from RelationshipConfig using helper
  const relatedEntityDefinitionId = useMemo(() => {
    if (!field.relationship) return null
    return getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
  }, [field.relationship])

  // Get target resource icon/color for relationship fields
  const targetResourceProps = useResourceProperty(relatedEntityDefinitionId, ['icon', 'color'])

  // Determine icon based on field type
  const getIcon = () => {
    if (isSelected) {
      return <Check className='size-4' />
    }

    if (isRelationship && targetResourceProps) {
      return (
        <EntityIcon iconId={targetResourceProps.icon} color={targetResourceProps.color} size='xs' />
      )
    }

    // Regular field - use fieldType icon, fall back to BaseType → FieldType mapping for system fields
    const effectiveFieldType =
      (field.fieldType as FieldType) ||
      (field.type ? mapBaseTypeToFieldType(field.type as any) : undefined)
    const iconId = (effectiveFieldType && fieldTypeOptions[effectiveFieldType]?.iconId) ?? 'circle'
    return <EntityIcon iconId={iconId} size='xs' className='text-muted-foreground' />
  }

  /**
   * Handle selection or drill-down
   */
  const handleSelect = () => {
    if (canDrillDown && onDrillDown) {
      onDrillDown()
    } else {
      onSelect()
    }
  }

  return (
    <CommandItem
      value={field.resourceFieldId ?? field.id}
      onSelect={handleSelect}
      className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        {getIcon()}
        <span>{field.label}</span>
      </div>
      {canDrillDown && <ChevronRight className='size-4 opacity-50' />}
    </CommandItem>
  )
})
