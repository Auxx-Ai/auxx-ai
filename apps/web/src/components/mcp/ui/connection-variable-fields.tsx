// apps/web/src/components/mcp/ui/connection-variable-fields.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
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
 * Connection-variable rows + optional bearer-token row, shared by the curated connect dialog
 * and the template dialog's fields step. Render inside a `VarEditorField`.
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
      {variables.map((variable) => (
        <VarEditorFieldRow
          key={variable.key}
          title={variable.label}
          description={variable.description}
          type={BaseType.STRING}
          showIcon
          isRequired={variable.required !== false}
          validationError={errors[variable.key]}>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={values[variable.key] ?? ''}
            onChange={(v) => onValueChange(variable.key, (v as string) ?? '')}
            placeholder={variable.placeholder}
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
            value={token}
            onChange={(v) => onTokenChange?.((v as string) ?? '')}
            placeholder='Bearer token'
            disabled={disabled}
          />
        </VarEditorFieldRow>
      )}
    </>
  )
}
