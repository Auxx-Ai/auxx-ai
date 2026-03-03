// apps/web/src/components/workflow/ui/input-editor/get-input-component.ts

import type { RelationshipType } from '@auxx/types/custom-field'
import {
  ActorInput,
  AddressInput,
  ArrayInput,
  BooleanInput,
  CurrencyInput,
  DateTimeInput,
  EnumInput,
  FileInput,
  MultiSelectInput,
  NumberInput,
  ObjectInput,
  PhoneInput,
  RelationInput,
  StringInput,
  TagsInput,
} from '~/components/workflow/nodes/shared/node-inputs'
import { BaseType } from '~/components/workflow/types'

/**
 * Map BaseType to appropriate input component
 * Shared by both ConstantInput and VariableInput
 */
export function getInputComponent(type: BaseType, fieldOptions?: FieldOptions) {
  switch (type) {
    case BaseType.ACTOR:
      return ActorInput
    case BaseType.RELATION:
    case BaseType.REFERENCE:
      return RelationInput
    case BaseType.STRING:
    case BaseType.EMAIL:
    case BaseType.URL:
      return StringInput
    case BaseType.PHONE:
      return PhoneInput
    case BaseType.NUMBER:
      return NumberInput
    case BaseType.BOOLEAN:
      return BooleanInput
    case BaseType.ARRAY:
      if (fieldOptions?.multiSelect) return MultiSelectInput
      return ArrayInput
    case BaseType.OBJECT:
    case BaseType.JSON:
      return ObjectInput
    case BaseType.DATE:
    case BaseType.DATETIME:
    case BaseType.TIME:
      return DateTimeInput
    case BaseType.ENUM:
      return EnumInput
    case BaseType.FILE:
      return FileInput
    case BaseType.CURRENCY:
      return CurrencyInput
    case BaseType.ADDRESS:
      return AddressInput
    case BaseType.TAGS:
      return TagsInput
    default:
      return StringInput // Default fallback
  }
}

/**
 * FieldOptions type for type-specific configuration
 */
export interface FieldOptions {
  /** For ENUM/SELECT types */
  enum?: Array<{ label: string; value: string }>
  /** For CURRENCY type */
  currency?: {
    currencyCode?: string
    decimalPlaces?: number | 'no-decimal'
    displayType?: string
    groups?: 'no-groups' | string
  }
  /** For BOOLEAN type - variant */
  variant?: 'button-group' | 'switch'
  /** For BOOLEAN type - label shown next to switch */
  label?: string
  /** For FILE type */
  allowMultiple?: boolean
  /** For STRING type */
  string?: {
    multiline?: boolean
    minLength?: number
    maxLength?: number
  }
  /** For RELATION/REFERENCE types - reference to field in registry */
  fieldReference?: string
  /** For RELATION types - relationship cardinality (has_many, belongs_to, etc.) */
  relationshipType?: RelationshipType
  /** For ACTOR type — actor picker configuration */
  actor?: { target?: 'user' | 'group' | 'both'; multiple?: boolean }
  /** For MULTI_SELECT type — triggers MultiSelectInput instead of ArrayInput */
  multiSelect?: boolean
  /** For ENUM/SELECT type — SelectTrigger variant override */
  selectVariant?: 'transparent' | 'outline'
}

/**
 * Get component-specific props based on varType
 * Maps ConstantInput props to node-input component props
 */
export function getSpecificPropsForType(
  varType: BaseType,
  commonProps: {
    placeholder?: string
    fieldOptions?: FieldOptions
  }
): Record<string, any> {
  const { placeholder, fieldOptions } = commonProps

  switch (varType) {
    case BaseType.EMAIL:
      return { validationType: 'email' }

    case BaseType.URL:
      return { validationType: 'url' }

    // BaseType.PHONE uses dedicated PhoneInput component, no special props needed

    case BaseType.ENUM:
      return {
        options: fieldOptions?.enum || fieldOptions?.options,
        selectVariant: fieldOptions?.selectVariant,
      }

    case BaseType.DATE:
      return { type: 'date', triggerProps: { className: 'w-full ps-0' } }

    case BaseType.DATETIME:
      return { type: 'datetime', triggerProps: { className: 'w-full ps-0' } }

    case BaseType.TIME:
      return { type: 'time', triggerProps: { className: 'w-full ps-0' } }

    case BaseType.ACTOR:
      return {
        target: fieldOptions?.actor?.target ?? 'user',
        multi: fieldOptions?.actor?.multiple ?? false,
      }

    case BaseType.RELATION:
    case BaseType.REFERENCE:
      // For RELATION types, pass fieldReference and relationshipType from fieldOptions
      // Hide clear button since VarEditor already provides its own
      return {
        fieldReference: fieldOptions?.fieldReference,
        relationshipType: fieldOptions?.relationshipType,
        showClear: false,
      }

    case BaseType.FILE:
      return {
        placeholder: placeholder || 'Select files...',
        allowMultiple: fieldOptions?.allowMultiple ?? true,
      }

    case BaseType.CURRENCY: {
      const currency = fieldOptions?.currency
      return {
        currencyCode: currency?.currencyCode ?? 'USD',
        decimalPlaces: currency?.decimalPlaces === 'no-decimal' ? 0 : 2,
        displayType: currency?.displayType ?? 'symbol',
        useGrouping: currency?.groups !== 'no-groups',
      }
    }

    case BaseType.ADDRESS:
      return {}

    case BaseType.ARRAY:
      if (fieldOptions?.multiSelect) {
        return { options: fieldOptions.enum || [] }
      }
      return {}

    case BaseType.TAGS:
      return {
        allowMultiple: true,
      }

    case BaseType.BOOLEAN: {
      return {
        variant: fieldOptions?.variant,
        label: fieldOptions?.label,
      }
    }

    case BaseType.STRING: {
      const stringOpts = fieldOptions?.string
      return {
        multiline: stringOpts?.multiline,
        minLength: stringOpts?.minLength,
        maxLength: stringOpts?.maxLength,
      }
    }

    default:
      return {}
  }
}
