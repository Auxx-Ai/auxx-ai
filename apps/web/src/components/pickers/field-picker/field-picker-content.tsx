// apps/web/src/components/pickers/field-picker/field-picker-content.tsx

'use client'

import { FieldTypeValues } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import type { FieldReference, ResourceFieldId } from '@auxx/types/field'
import { isFieldPath, parseResourceFieldId, toFieldPath } from '@auxx/types/field'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  CommandSeparator,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import { FieldItem } from './field-item'
import type {
  ExcludeFilter,
  FieldPickerContentProps,
  FieldPickerInnerContentProps,
  FieldPickerNavigationItem,
} from './types'

/**
 * Check if field should be excluded based on flexible excludeFields prop.
 * Supports: FieldType enum, entityDefinitionId, or ResourceFieldId
 */
function shouldExcludeField(field: ResourceField, excludeFields?: ExcludeFilter[]): boolean {
  if (!excludeFields?.length) return false

  for (const filter of excludeFields) {
    // Check if filter is a FieldType enum value
    if (FieldTypeValues.includes(filter as FieldType)) {
      if (field.fieldType === filter) return true
      continue
    }

    // Check if filter is a ResourceFieldId (contains ":")
    if (typeof filter === 'string' && filter.includes(':')) {
      if (field.resourceFieldId === filter) return true
      continue
    }

    // Otherwise treat as entityDefinitionId
    if (field.resourceFieldId) {
      const { entityDefinitionId } = parseResourceFieldId(field.resourceFieldId)
      if (entityDefinitionId === filter) return true
    }
  }

  return false
}

/**
 * Inner content component that can use either CommandNavigation context or external navigation.
 * When externalNavigation is provided, uses that instead of useCommandNavigation().
 * This allows nesting within an existing CommandNavigation without creating duplicate stacks.
 */
export function FieldPickerInnerContent({
  entityDefinitionId,
  fieldReferences = [],
  excludeFields,
  onSelect,
  mode = 'single',
  closeOnSelect = mode === 'single',
  onClose,
  onCreateField,
  searchPlaceholder = 'Search fields...',
  externalNavigation,
  renderAdditionalContent,
  showBreadcrumb = true,
}: FieldPickerInnerContentProps) {
  const [search, setSearch] = useState('')

  // Use external navigation if provided, otherwise use CommandNavigation context
  const contextNav = useCommandNavigation<FieldPickerNavigationItem>()
  const { stack, current, push, isAtRoot } = externalNavigation ?? contextNav

  // Determine which entity to show fields for
  const currentEntityDefinitionId = current?.targetEntityDefinitionId ?? entityDefinitionId

  // Get fields for current entity
  const { fields } = useResourceFields(currentEntityDefinitionId)

  // Get current entity's label and icon (for drilled-down view)
  const entityProps = useResourceProperty(currentEntityDefinitionId, ['label', 'icon', 'color'])

  // Filter fields (all fields together, not separated by type)
  const filteredFields = useMemo(() => {
    return fields.filter((field) => {
      // Skip excluded fields
      if (shouldExcludeField(field, excludeFields)) return false

      // Skip inactive fields
      if (field.active === false) return false

      // Apply search filter
      if (search && !field.label.toLowerCase().includes(search.toLowerCase())) return false

      return true
    })
  }, [fields, excludeFields, search])

  /**
   * Check if a field is currently selected
   */
  const isFieldSelected = useCallback(
    (field: ResourceField): boolean => {
      if (!field.resourceFieldId) return false

      // Build the full path for this field
      const pathIds = stack.map((item) => item.resourceFieldId)
      pathIds.push(field.resourceFieldId)

      // Check if any fieldReference matches
      return fieldReferences.some((ref) => {
        if (isFieldPath(ref)) {
          // Compare paths
          if (ref.length !== pathIds.length) return false
          return ref.every((id, i) => id === pathIds[i])
        }
        // Direct ResourceFieldId comparison (only at root)
        return stack.length === 0 && ref === field.resourceFieldId
      })
    },
    [fieldReferences, stack]
  )

  /**
   * Handle field selection
   */
  const handleSelectField = useCallback(
    (field: ResourceField) => {
      if (!field.resourceFieldId) return

      let fieldReference: FieldReference

      if (stack.length === 0) {
        // Root level: just ResourceFieldId
        fieldReference = field.resourceFieldId
      } else {
        // Nested: build FieldPath from stack + current field
        const pathIds: ResourceFieldId[] = stack.map((item) => item.resourceFieldId)
        pathIds.push(field.resourceFieldId)
        fieldReference = toFieldPath(pathIds)
      }

      onSelect(fieldReference, field)

      if (closeOnSelect && onClose) {
        onClose()
      }
    },
    [stack, onSelect, closeOnSelect, onClose]
  )

  /**
   * Handle drilling into a relationship
   */
  const handleDrillInto = useCallback(
    (field: ResourceField) => {
      const relatedEntityDefId = field.relationship
        ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
        : null
      if (!relatedEntityDefId || !field.resourceFieldId) return

      push({
        id: field.id,
        label: field.label,
        resourceFieldId: field.resourceFieldId,
        targetEntityDefinitionId: relatedEntityDefId,
      })
      setSearch('')
    },
    [push]
  )

  /**
   * Handle selecting the current relationship (when drilled down)
   */
  const handleSelectCurrentRelationship = useCallback(() => {
    if (stack.length === 0 || !current) return

    // Build FieldPath from stack
    const pathIds: ResourceFieldId[] = stack.map((item) => item.resourceFieldId)
    const fieldReference = toFieldPath(pathIds)

    // Create a minimal field representation for the callback
    onSelect(fieldReference, {
      id: current.id,
      label: current.label,
      resourceFieldId: current.resourceFieldId,
    } as ResourceField)

    if (closeOnSelect && onClose) {
      onClose()
    }
  }, [stack, current, onSelect, closeOnSelect, onClose])

  // Shared content (input + list)
  const content = (
    <>
      <CommandInput
        placeholder={searchPlaceholder}
        value={search}
        onValueChange={setSearch}
        autoFocus
      />

      <CommandList>
        <CommandEmpty>No fields found.</CommandEmpty>

        {/* When drilled into a relationship, show entity selector first */}
        {!isAtRoot && current && entityProps && (
          <>
            <CommandGroup>
              <CommandItem onSelect={handleSelectCurrentRelationship}>
                <EntityIcon iconId={entityProps.icon} color={entityProps.color} size='xs' />
                <span>{entityProps.label}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* All fields (regular and relationships together) */}
        {filteredFields.length > 0 && (
          <CommandGroup>
            {!isAtRoot && <CommandGroupLabel>Fields</CommandGroupLabel>}
            {filteredFields.map((field) => (
              <FieldItem
                key={field.id}
                field={field}
                isSelected={mode === 'multi' && isFieldSelected(field)}
                canDrillDown={!!field.relationship}
                onSelect={() => handleSelectField(field)}
                onDrillDown={field.relationship ? () => handleDrillInto(field) : undefined}
              />
            ))}
          </CommandGroup>
        )}

        {/* Create field button */}
        {onCreateField && isAtRoot && (
          <>
            {filteredFields.length > 0 && <CommandSeparator />}
            <CommandGroup>
              <CommandItem onSelect={onCreateField}>
                <Plus className='size-4' />
                <span>Create field</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {/* Additional content (e.g., Functions for CALC) */}
        {renderAdditionalContent?.(search)}
      </CommandList>
    </>
  )

  // When using external navigation, parent handles Command wrapper and breadcrumb
  if (externalNavigation) {
    return content
  }

  // Standalone usage: wrap with Command and breadcrumb
  return (
    <Command shouldFilter={false}>
      {showBreadcrumb && <CommandBreadcrumb rootLabel='Fields' />}
      {content}
    </Command>
  )
}

/**
 * FieldPickerContent - Field picker with relationship drill-down.
 * Uses CommandNavigation for stack-based navigation.
 */
export function FieldPickerContent(props: FieldPickerContentProps) {
  return (
    <CommandNavigation<FieldPickerNavigationItem>>
      <FieldPickerInnerContent {...props} />
    </CommandNavigation>
  )
}
