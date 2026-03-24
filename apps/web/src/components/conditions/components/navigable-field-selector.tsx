// apps/web/src/components/conditions/components/navigable-field-selector.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import type { FieldReference, ResourceFieldId } from '@auxx/types/field'
import { isFieldPath } from '@auxx/types/field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { type BreadcrumbSegment, SmartBreadcrumb } from '@auxx/ui/components/smart-breadcrumb'
import { Variable } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { FieldPickerContent } from '~/components/pickers/field-picker'
import { useFields } from '~/components/resources/hooks/use-field'
import type { FieldDefinition } from '../types'

interface NavigableFieldSelectorProps {
  /** Current condition fieldId — real FieldReference, NOT encoded */
  value: FieldReference | undefined
  /** Called when user selects a field */
  onSelect: (fieldReference: FieldReference, fieldDef: FieldDefinition) => void
  /** Root entity definition ID */
  entityDefinitionId: string
  /** Fields to exclude from picker */
  excludeFields?: string[]
  disabled?: boolean
  placeholder?: string
  /** Custom trigger renderer */
  renderTrigger?: (props: { isOpen: boolean; onClick: () => void }) => React.ReactNode
  /** Controlled open state */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Convert a ResourceField from the picker into a FieldDefinition for the condition system.
 */
function resourceFieldToFieldDef(
  field: ResourceField,
  fieldReference: FieldReference
): FieldDefinition {
  const id = Array.isArray(fieldReference) ? fieldReference.join('::') : (fieldReference as string)

  return {
    id,
    label: field.label,
    type: field.type,
    fieldType: field.fieldType,
    operators: getFieldOperators(field) as any[],
    options: field.options,
    fieldKey: field.key,
    fieldReference: field.resourceFieldId,
    targetEntityDefinitionId: field.relationship
      ? (getRelatedEntityDefinitionId(field.relationship as RelationshipConfig) ?? undefined)
      : undefined,
  }
}

/**
 * Navigable field selector with relation drill-down.
 * Uses FieldPickerContent (CommandNavigation + FieldPickerInnerContent) for stack-based navigation.
 * Replaces ResourceFieldSelector when entityDefinitionId is available.
 */
export function NavigableFieldSelector({
  value,
  onSelect,
  entityDefinitionId,
  excludeFields,
  disabled,
  placeholder = 'Select field',
  renderTrigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: NavigableFieldSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = controlledOnOpenChange || setInternalOpen

  // Resolve field labels for display
  // For FieldPath: resolve all segments for breadcrumb
  // For single ResourceFieldId: resolve just that field
  const fieldIdsForLabels = useMemo((): (ResourceFieldId | null)[] => {
    if (!value) return []
    if (isFieldPath(value)) return value as ResourceFieldId[]
    return [value as ResourceFieldId]
  }, [value])

  const resolvedFields = useFields(fieldIdsForLabels)

  /** Handle field selection from picker */
  const handleSelect = useCallback(
    (fieldReference: FieldReference, field: ResourceField) => {
      const fieldDef = resourceFieldToFieldDef(field, fieldReference)
      onSelect(fieldReference, fieldDef)
      setIsOpen(false)
    },
    [onSelect, setIsOpen]
  )

  // Selected field references for highlighting
  const fieldReferences = useMemo(() => {
    if (!value) return []
    return [value]
  }, [value])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {renderTrigger ? (
          renderTrigger({ isOpen, onClick: () => setIsOpen(!isOpen) })
        ) : (
          <div className='cursor-pointer'>
            {value ? (
              <div className='flex justify-start'>
                {isFieldPath(value) ? (
                  <SmartBreadcrumb
                    segments={(value as ResourceFieldId[]).map(
                      (rfId, i): BreadcrumbSegment => ({
                        id: rfId,
                        label: resolvedFields[i]?.label ?? rfId,
                      })
                    )}
                    mode='display'
                    size='sm'
                    className='flex-1 min-w-0'
                  />
                ) : (
                  <div className='inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] border-border bg-background px-1.5 text-primary-500 shadow-xs'>
                    <Variable className='size-3.5 shrink-0 text-accent-500' />
                    <div className='ml-0.5 truncate text-xs font-medium'>
                      {resolvedFields[0]?.label ?? (value as string)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className='text-muted-foreground text-sm'>{placeholder}</span>
            )}
          </div>
        )}
      </PopoverTrigger>
      <PopoverContent className='min-w-[250px] p-0' align='start'>
        <FieldPickerContent
          entityDefinitionId={entityDefinitionId}
          fieldReferences={fieldReferences}
          excludeFields={excludeFields}
          onSelect={handleSelect}
          mode='single'
          closeOnSelect={false}
          onClose={() => setIsOpen(false)}
          searchPlaceholder='Search fields...'
        />
      </PopoverContent>
    </Popover>
  )
}
