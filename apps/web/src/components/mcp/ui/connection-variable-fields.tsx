// apps/web/src/components/mcp/ui/connection-variable-fields.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'

interface ConnectionVariableFieldsProps {
  /** Connection-variable defs from the server's ConnectionDefinition (or template). */
  variables: ConnectionVariable[]
  values: Record<string, string>
  onValueChange: (key: string, value: string) => void
  /** Render a bearer-token row (secret-auth servers). Its error key is `__token`. */
  showToken?: boolean
  token?: string
  onTokenChange?: (token: string) => void
  errors: Record<string, string>
  disabled?: boolean
}

/**
 * Conditional visibility (`displayOptions.show`): a field shows only when every referenced
 * key currently holds one of its allowed values. Values compare as strings since the form
 * stores everything as strings (booleans as `'true'`/`'false'`).
 */
function isFieldVisible(v: ConnectionVariable, values: Record<string, string>): boolean {
  const show = v.displayOptions?.show
  if (!show) return true
  for (const [key, allowed] of Object.entries(show)) {
    if (!allowed.map(String).includes(values[key] ?? '')) return false
  }
  return true
}

/** Assemble the field renderer's `fieldOptions` from a connection variable. */
function fieldOptionsFor(v: ConnectionVariable): FieldOptions {
  // Booleans render as a switch (not the default button-group) in the connect form.
  return { options: v.options, multiline: v.multiline, secret: v.secret, variant: 'switch' }
}

/** Read a stored string into the native value `FieldInputAdapter` expects for this type. */
function toFieldValue(v: ConnectionVariable, stored: string): unknown {
  if (v.type === FieldType.CHECKBOX) return stored === 'true'
  return stored
}

/** Convert `FieldInputAdapter`'s native onChange value back into the stored string. */
function fromFieldValue(v: ConnectionVariable, next: unknown): string {
  switch (v.type) {
    case FieldType.CHECKBOX:
      return String(Boolean(next))
    case FieldType.NUMBER:
      return next === '' || next == null ? '' : String(next)
    case FieldType.SINGLE_SELECT:
      return Array.isArray(next) ? (next[0] ?? '') : String(next ?? '')
    default:
      return (next as string) ?? ''
  }
}

/** Full-width controls flush to the row label (picker triggers + text/number inputs). */
const FIELD_TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' }

/**
 * Per-variable trigger props. Optional fields get a clear ("X") affordance so a
 * single-select can be unselected; required fields keep it off (clearing would
 * just fail required validation).
 */
function triggerPropsFor(v: ConnectionVariable) {
  return { ...FIELD_TRIGGER_PROPS, showClear: v.required === false }
}

/**
 * Connection-variable rows + optional bearer-token row, shared by the curated connect dialog
 * and the template dialog's fields step. Each row renders the control matching its platform
 * `FieldType` (text/number/checkbox/select), masks `secret` fields, and respects
 * `displayOptions.show` visibility. Render inside a `VarEditorField`.
 */
export function ConnectionVariableFields({
  variables,
  values,
  onValueChange,
  showToken = false,
  token = '',
  onTokenChange,
  errors,
  disabled = false,
}: ConnectionVariableFieldsProps) {
  return (
    <>
      {variables
        .filter((variable) => isFieldVisible(variable, values))
        .map((variable) => (
          <VarEditorFieldRow
            key={variable.key}
            title={variable.label}
            description={variable.description}
            type={BaseType.STRING}
            showIcon
            isRequired={variable.required !== false}
            validationError={errors[variable.key]}>
            <FieldInputAdapter
              fieldType={variable.type ?? FieldType.TEXT}
              fieldOptions={fieldOptionsFor(variable)}
              value={toFieldValue(variable, values[variable.key] ?? '')}
              onChange={(v) => onValueChange(variable.key, fromFieldValue(variable, v))}
              placeholder={variable.placeholder}
              triggerProps={triggerPropsFor(variable)}
              disabled={disabled}
            />
          </VarEditorFieldRow>
        ))}

      {showToken && (
        <VarEditorFieldRow
          title='Token'
          type={BaseType.STRING}
          showIcon
          isRequired
          validationError={errors.__token}>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ secret: true }}
            value={token}
            onChange={(v) => onTokenChange?.((v as string) ?? '')}
            placeholder='Bearer token'
            triggerProps={FIELD_TRIGGER_PROPS}
            disabled={disabled}
          />
        </VarEditorFieldRow>
      )}
    </>
  )
}
