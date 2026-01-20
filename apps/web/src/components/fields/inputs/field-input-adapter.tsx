// apps/web/src/components/fields/inputs/field-input-adapter.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { isMultiRelationship } from '@auxx/lib/field-values/client'
import { getRelatedEntityDefinitionId, type SelectOption, type RelationshipConfig } from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/lib/resources/client'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { SelectFieldInput, getSelectConfig } from './select-input-field'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import {
  StringInput,
  NumberInput,
  BooleanInput,
  DateTimeInput,
  FileInput,
  CurrencyInput,
  AddressInput,
  PhoneInput,
} from '~/components/workflow/nodes/shared/node-inputs'

/**
 * Props for FieldInputAdapter
 */
export interface FieldInputAdapterProps {
  /** The FieldType of this field */
  fieldType: string
  /** Field-specific options - uses existing FieldOptions from converters */
  fieldOptions?: FieldOptions
  /** Current value - already normalized by caller */
  value: unknown
  /** Change handler - receives the new value directly */
  onChange: (value: unknown) => void
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Callback when options change (for TAGS management) */
  onOptionsChange?: (options: SelectOption[]) => void
}

/**
 * FieldInputAdapter
 * Renders the appropriate input component for a given FieldType.
 * Expects values to already be in correct format - does NOT normalize.
 */
export function FieldInputAdapter({
  fieldType,
  fieldOptions,
  value,
  onChange,
  placeholder = 'Enter value...',
  disabled = false,
  className,
  onOptionsChange,
}: FieldInputAdapterProps) {
  // For NodeInputProps-compatible components
  const [errors, setErrors] = useState<Record<string, string>>({})

  // State for entity creation dialog (for RELATIONSHIP fields)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createEntityDefinitionId, setCreateEntityDefinitionId] = useState<string | null>(null)

  /**
   * Adapter for NodeInputProps onChange
   */
  const handleNodeInputChange = useCallback(
    (_name: string, val: unknown) => {
      onChange(val)
    },
    [onChange]
  )

  /**
   * Adapter for NodeInputProps onError
   */
  const handleError = useCallback((name: string, error: string | null) => {
    setErrors((prev) => {
      if (error === null) {
        const next = { ...prev }
        delete next[name]
        return next
      }
      return { ...prev, [name]: error }
    })
  }, [])

  /**
   * Common props for NodeInputProps-compatible components
   */
  const nodeInputProps = useMemo(
    () => ({
      inputs: { _value: value },
      errors,
      onChange: handleNodeInputChange,
      onError: handleError,
      isLoading: disabled,
      name: '_value',
      placeholder,
    }),
    [value, errors, handleNodeInputChange, handleError, disabled, placeholder]
  )

  // Route to appropriate component based on fieldType
  switch (fieldType) {
    // ─────────────────────────────────────────────────────────────────
    // RELATIONSHIP - uses MultiRelationInput directly
    // Value: ResourceId[] (array of resource identifiers)
    // ─────────────────────────────────────────────────────────────────
    case FieldType.RELATIONSHIP: {
      const relationship = fieldOptions?.relationship
      if (!relationship) {
        return <div className="text-muted-foreground text-sm">Missing relationship config</div>
      }

      // Derive entityDefinitionId from relationship config
      const entityDefinitionId = getRelatedEntityDefinitionId(relationship as RelationshipConfig)

      if (!entityDefinitionId) {
        return <div className="text-muted-foreground text-sm">Missing entity definition</div>
      }

      // Derive multi from relationship type using helper
      const multi = isMultiRelationship(relationship.relationshipType)

      // Value is already RecordId[] from caller - just pass through
      const recordIds = (value as RecordId[]) || []

      /**
       * Handle opening the create dialog
       */
      const handleOpenCreate = () => {
        setCreateEntityDefinitionId(entityDefinitionId)
        setCreateDialogOpen(true)
      }

      /**
       * Handle instance creation - add the new instance to selection
       */
      const handleInstanceCreated = (instanceId: string) => {
        const newRecordId = toRecordId(entityDefinitionId, instanceId)
        const updatedIds = multi ? [...recordIds, newRecordId] : [newRecordId]
        onChange(updatedIds)
      }

      return (
        <>
          <MultiRelationInput
            entityDefinitionId={entityDefinitionId}
            value={recordIds}
            onChange={onChange}
            multi={multi}
            placeholder={placeholder}
            disabled={disabled}
            className={className}
            onCreate={handleOpenCreate}
          />
          {createDialogOpen && createEntityDefinitionId && (
            <EntityInstanceDialog
              open={createDialogOpen}
              onOpenChange={setCreateDialogOpen}
              entityDefinitionId={createEntityDefinitionId}
              onSaved={handleInstanceCreated}
            />
          )}
        </>
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // SELECT TYPES - unified case using getSelectConfig()
    // Value: string[] (array of option values)
    // ─────────────────────────────────────────────────────────────────
    case FieldType.SINGLE_SELECT:
    case FieldType.MULTI_SELECT:
    case FieldType.TAGS: {
      const options = fieldOptions?.options ?? []
      const config = getSelectConfig(fieldType)

      // Value should already be string[] - caller normalizes
      const selectedValues = (value as string[]) || []

      return (
        <SelectFieldInput
          options={options}
          value={selectedValues}
          onChange={onChange}
          onOptionsChange={onOptionsChange}
          config={config}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // TEXT TYPES - uses StringInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.TEXT:
    case FieldType.NAME:
      return <StringInput {...nodeInputProps} />

    case FieldType.EMAIL:
      return <StringInput {...nodeInputProps} validationType="email" />

    case FieldType.URL:
      return <StringInput {...nodeInputProps} validationType="url" />

    case FieldType.RICH_TEXT:
      return <StringInput {...nodeInputProps} multiline={true} />

    // ─────────────────────────────────────────────────────────────────
    // PHONE - uses PhoneInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.PHONE_INTL:
      return <PhoneInput {...nodeInputProps} />

    // ─────────────────────────────────────────────────────────────────
    // NUMBER - uses NumberInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.NUMBER:
      return <NumberInput {...nodeInputProps} />

    // ─────────────────────────────────────────────────────────────────
    // CURRENCY - uses CurrencyInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.CURRENCY: {
      const currency = fieldOptions?.currency
      return (
        <CurrencyInput
          {...nodeInputProps}
          currencyCode={currency?.currencyCode ?? 'USD'}
          decimalPlaces={currency?.decimalPlaces === 'no-decimal' ? 0 : 2}
          displayType={currency?.displayType ?? 'symbol'}
          useGrouping={currency?.groups !== 'no-groups'}
        />
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // BOOLEAN - uses BooleanInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.CHECKBOX:
      return <BooleanInput {...nodeInputProps} />

    // ─────────────────────────────────────────────────────────────────
    // DATE/TIME - uses DateTimeInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.DATE:
      return <DateTimeInput {...nodeInputProps} type="date" />

    case FieldType.DATETIME:
      return <DateTimeInput {...nodeInputProps} type="datetime" />

    case FieldType.TIME:
      return <DateTimeInput {...nodeInputProps} type="time" />

    // ─────────────────────────────────────────────────────────────────
    // FILE - uses FileInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.FILE:
      return (
        <FileInput
          {...nodeInputProps}
          placeholder={placeholder}
          allowMultiple={fieldOptions?.file?.allowMultiple ?? false}
        />
      )

    // ─────────────────────────────────────────────────────────────────
    // ADDRESS - uses AddressInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.ADDRESS:
    case FieldType.ADDRESS_STRUCT:
      return <AddressInput {...nodeInputProps} />

    // ─────────────────────────────────────────────────────────────────
    // FALLBACK
    // ─────────────────────────────────────────────────────────────────
    default:
      return <StringInput {...nodeInputProps} />
  }
}
