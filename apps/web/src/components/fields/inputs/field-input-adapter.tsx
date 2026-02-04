// apps/web/src/components/fields/inputs/field-input-adapter.tsx
'use client'

import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react'
import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { isMultiRelationship } from '@auxx/lib/field-values/client'
import {
  getRelatedEntityDefinitionId,
  type SelectOption,
  type RelationshipConfig,
  type ActorOptions,
} from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'
import type { ActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/lib/resources/client'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { ActorPicker } from '~/components/pickers/actor-picker/actor-picker'
import { SelectFieldInput, getSelectConfig } from './select-input-field'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import type { PickerTriggerOptions } from '~/components/ui/picker-trigger'
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
import { NameFieldInput, type NameValue } from './name-field-input'

/**
 * Wrapper for inline inputs that focuses the input when `open` becomes true.
 * Used for text, number, and other non-picker inputs.
 */
interface FocusableInputWrapperProps {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function FocusableInputWrapper({ children, open, onOpenChange }: FocusableInputWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && containerRef.current) {
      // Find the first focusable input element within the container
      const input = containerRef.current.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input, textarea'
      )
      if (input) {
        input.focus()
        // Notify parent that we've handled the open state
        onOpenChange?.(false)
      }
    }
  }, [open, onOpenChange])

  return <div ref={containerRef}>{children}</div>
}

/** AutoGrow options for text inputs */
export interface AutoGrowOptions {
  minWidth?: number
  maxWidth?: number
  placeholderIsMinWidth?: boolean
}

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
  /** Callback when options change (for TAGS management) */
  onOptionsChange?: (options: SelectOption[]) => void
  /** Override multi-select behavior (for operators like "in"/"not in") */
  allowMultiple?: boolean
  /** Trigger customization options for picker-based inputs */
  triggerProps?: PickerTriggerOptions
  /** Controlled open state for picker-based inputs */
  open?: boolean
  /** Callback when picker open state changes */
  onOpenChange?: (open: boolean) => void
  /** Additional className for inline text inputs */
  inputClassName?: string
  /** Enable auto-grow for text inputs */
  autoGrow?: AutoGrowOptions
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
  onOptionsChange,
  allowMultiple,
  triggerProps,
  open,
  onOpenChange,
  inputClassName,
  autoGrow,
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

      // Use allowMultiple if provided (from operator), otherwise derive from relationship type
      const multi = allowMultiple ?? isMultiRelationship(relationship.relationshipType)

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
            onCreate={handleOpenCreate}
            triggerProps={triggerProps}
            open={open}
            onOpenChange={onOpenChange}
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
    // ACTOR - uses ActorPicker
    // Value: ActorId[] (array of actor identifiers like "user:xxx" or "group:xxx")
    // ─────────────────────────────────────────────────────────────────
    case FieldType.ACTOR: {
      const actorOpts = fieldOptions?.actor as ActorOptions | undefined

      // Use allowMultiple if provided (from operator), otherwise use field options
      const multi = allowMultiple ?? actorOpts?.multiple

      // Value is already ActorId[] from caller
      const actorIds = (value as ActorId[]) || []

      return (
        <ActorPicker
          value={actorIds}
          onChange={onChange as (selected: ActorId[]) => void}
          target={actorOpts?.target}
          roles={actorOpts?.roles}
          multi={multi}
          emptyLabel={placeholder}
          disabled={disabled}
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
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
      const baseConfig = getSelectConfig(fieldType)
      // Override multi if allowMultiple is explicitly set
      const config =
        allowMultiple !== undefined ? { ...baseConfig, multi: allowMultiple } : baseConfig

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
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // NAME - uses NameFieldInput (popover with firstName + lastName)
    // Value: { firstName: string, lastName: string }
    // ─────────────────────────────────────────────────────────────────
    case FieldType.NAME: {
      const nameValue = (value as NameValue | null) ?? { firstName: '', lastName: '' }
      return (
        <NameFieldInput
          value={nameValue}
          onChange={onChange as (value: NameValue) => void}
          placeholder={placeholder}
          disabled={disabled}
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // TEXT - uses StringInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    case FieldType.TEXT:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <StringInput {...nodeInputProps} className={inputClassName} autoGrow={autoGrow} />
        </FocusableInputWrapper>
      )

    case FieldType.EMAIL:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <StringInput {...nodeInputProps} validationType="email" className={inputClassName} autoGrow={autoGrow} />
        </FocusableInputWrapper>
      )

    case FieldType.URL:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <StringInput {...nodeInputProps} validationType="url" className={inputClassName} autoGrow={autoGrow} />
        </FocusableInputWrapper>
      )

    case FieldType.RICH_TEXT:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <StringInput {...nodeInputProps} multiline={true} className={inputClassName} />
        </FocusableInputWrapper>
      )

    // ─────────────────────────────────────────────────────────────────
    // PHONE - uses PhoneInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    case FieldType.PHONE_INTL:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <PhoneInput {...nodeInputProps} />
        </FocusableInputWrapper>
      )

    // ─────────────────────────────────────────────────────────────────
    // NUMBER - uses NumberInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    case FieldType.NUMBER:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <NumberInput {...nodeInputProps} />
        </FocusableInputWrapper>
      )

    // ─────────────────────────────────────────────────────────────────
    // CURRENCY - uses CurrencyInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    case FieldType.CURRENCY: {
      const currency = fieldOptions?.currency
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <CurrencyInput
            {...nodeInputProps}
            currencyCode={currency?.currencyCode ?? 'USD'}
            decimalPlaces={currency?.decimalPlaces === 'no-decimal' ? 0 : 2}
            displayType={currency?.displayType ?? 'symbol'}
            useGrouping={currency?.groups !== 'no-groups'}
          />
        </FocusableInputWrapper>
      )
    }

    // ─────────────────────────────────────────────────────────────────
    // BOOLEAN - uses BooleanInput
    // ─────────────────────────────────────────────────────────────────
    case FieldType.CHECKBOX:
      return <BooleanInput {...nodeInputProps} />

    // ─────────────────────────────────────────────────────────────────
    // DATE/TIME - uses DateTimeInput with controlled open state
    // ─────────────────────────────────────────────────────────────────
    case FieldType.DATE:
      return (
        <DateTimeInput
          {...nodeInputProps}
          type="date"
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
      )

    case FieldType.DATETIME:
      return (
        <DateTimeInput
          {...nodeInputProps}
          type="datetime"
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
      )

    case FieldType.TIME:
      return (
        <DateTimeInput
          {...nodeInputProps}
          type="time"
          triggerProps={triggerProps}
          open={open}
          onOpenChange={onOpenChange}
        />
      )

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
    // ADDRESS - uses AddressInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    case FieldType.ADDRESS:
    case FieldType.ADDRESS_STRUCT:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <AddressInput {...nodeInputProps} />
        </FocusableInputWrapper>
      )

    // ─────────────────────────────────────────────────────────────────
    // FALLBACK - uses StringInput with focus wrapper
    // ─────────────────────────────────────────────────────────────────
    default:
      return (
        <FocusableInputWrapper open={open} onOpenChange={onOpenChange}>
          <StringInput {...nodeInputProps} className={inputClassName} autoGrow={autoGrow} />
        </FocusableInputWrapper>
      )
  }
}
