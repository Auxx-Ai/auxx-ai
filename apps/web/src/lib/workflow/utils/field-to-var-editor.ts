// apps/web/src/lib/workflow/utils/field-to-var-editor.ts

import { BaseType, VAR_MODE, type VarMode } from '~/components/workflow/types'
import type { FieldOptions } from '~/components/workflow/ui/input-editor/get-input-component'

/**
 * Result of mapping an SDK field type to VarEditor props.
 */
export interface VarEditorMappedProps {
  /** BaseType for VarEditor varType */
  varType: BaseType
  /** VarEditor mode: 'rich' for Tiptap, 'picker' for single variable selection */
  mode: VarMode
  /** Whether constant mode toggle is allowed */
  allowConstant: boolean
  /** Allowed variable types for filtering */
  allowedTypes: BaseType[]
  /** Type-specific field options (enum values, currency config, etc.) */
  fieldOptions?: FieldOptions
}

/**
 * Normalize an option to { label, value } format.
 */
function normalizeOption(opt: string | { label: string; value: string }): {
  label: string
  value: string
} {
  if (typeof opt === 'string') return { label: opt, value: opt }
  return opt
}

/**
 * Map an SDK field type + format to VarEditor props.
 *
 * Designed as an extensible switch — adding future BaseTypes means adding cases here.
 *
 * @param params.type - SDK field type (string, number, boolean, select)
 * @param params.format - Optional format hint (email, url, date, datetime, time)
 * @param params.options - Enum options for select fields
 * @param params.acceptsVariables - Whether the field accepts variable references
 * @param params.variableTypes - Allowed variable types for filtering
 */
export function mapFieldToVarEditorProps(params: {
  type: string
  format?: string
  options?: readonly (string | { label: string; value: string })[]
  acceptsVariables?: boolean
  variableTypes?: string[]
  variant?: string
}): VarEditorMappedProps {
  const { type, format, options, acceptsVariables, variableTypes, variant } = params

  // Determine allowConstant from acceptsVariables
  // When acceptsVariables is false/undefined, render in constant-only mode
  const allowConstant = acceptsVariables !== false

  // Map variableTypes to BaseType array
  const allowedTypes: BaseType[] = (variableTypes || [])
    .map((t) => mapStringToBaseType(t))
    .filter((t): t is BaseType => t !== null)

  // First check format overrides for string type
  if (type === 'string' && format) {
    switch (format) {
      case 'email':
        return {
          varType: BaseType.EMAIL,
          mode: VAR_MODE.RICH,
          allowConstant,
          allowedTypes,
          fieldOptions: undefined,
        }
      case 'url':
      case 'uri':
        return {
          varType: BaseType.URL,
          mode: VAR_MODE.RICH,
          allowConstant,
          allowedTypes,
          fieldOptions: undefined,
        }
      case 'date':
        return {
          varType: BaseType.DATE,
          mode: VAR_MODE.PICKER,
          allowConstant,
          allowedTypes,
          fieldOptions: undefined,
        }
      case 'datetime':
        return {
          varType: BaseType.DATETIME,
          mode: VAR_MODE.PICKER,
          allowConstant,
          allowedTypes,
          fieldOptions: undefined,
        }
      case 'time':
        return {
          varType: BaseType.TIME,
          mode: VAR_MODE.PICKER,
          allowConstant,
          allowedTypes,
          fieldOptions: undefined,
        }
    }
  }

  // Map by primary type
  switch (type) {
    case 'string':
      return {
        varType: BaseType.STRING,
        mode: VAR_MODE.RICH,
        allowConstant,
        allowedTypes,
        fieldOptions: undefined,
      }

    case 'number':
      return {
        varType: BaseType.NUMBER,
        mode: VAR_MODE.PICKER,
        allowConstant,
        allowedTypes,
        fieldOptions: undefined,
      }

    case 'boolean':
      return {
        varType: BaseType.BOOLEAN,
        mode: VAR_MODE.PICKER,
        allowConstant,
        allowedTypes,
        fieldOptions: { variant: 'switch' },
      }

    case 'select': {
      const normalizedOptions = options ? (options as any[]).map(normalizeOption) : []
      return {
        varType: BaseType.ENUM,
        mode: VAR_MODE.PICKER,
        allowConstant,
        allowedTypes,
        fieldOptions: { enum: normalizedOptions, selectVariant: variant },
      }
    }

    default:
      // Unsupported type — graceful fallback to STRING/RICH
      return {
        varType: BaseType.STRING,
        mode: VAR_MODE.RICH,
        allowConstant,
        allowedTypes,
        fieldOptions: undefined,
      }
  }
}

/**
 * Map a field type string to a BaseType enum value.
 * Used for both varType resolution and type icon display.
 */
export function mapFieldType(type?: string, format?: string): BaseType {
  if (!type) return BaseType.STRING

  // Check format first for string types
  if (type === 'string' && format) {
    switch (format) {
      case 'email':
        return BaseType.EMAIL
      case 'url':
      case 'uri':
        return BaseType.URL
      case 'date':
        return BaseType.DATE
      case 'datetime':
        return BaseType.DATETIME
      case 'time':
        return BaseType.TIME
    }
  }

  switch (type) {
    case 'string':
      return BaseType.STRING
    case 'number':
      return BaseType.NUMBER
    case 'boolean':
      return BaseType.BOOLEAN
    case 'select':
      return BaseType.ENUM
    case 'array':
      return BaseType.ARRAY
    case 'object':
    case 'struct':
      return BaseType.OBJECT
    default:
      return BaseType.STRING
  }
}

/**
 * Map a string to BaseType for variableTypes filtering.
 */
function mapStringToBaseType(typeStr: string): BaseType | null {
  const mapping: Record<string, BaseType> = {
    string: BaseType.STRING,
    number: BaseType.NUMBER,
    boolean: BaseType.BOOLEAN,
    object: BaseType.OBJECT,
    array: BaseType.ARRAY,
    date: BaseType.DATE,
    datetime: BaseType.DATETIME,
    time: BaseType.TIME,
    email: BaseType.EMAIL,
    url: BaseType.URL,
    file: BaseType.FILE,
    json: BaseType.JSON,
    any: BaseType.ANY,
    enum: BaseType.ENUM,
  }
  return mapping[typeStr] ?? null
}
