// apps/web/src/lib/extensions/components/workflow/inputs/var-input.tsx

'use client'

import { VarEditor } from '~/components/workflow/ui/input-editor/var-editor'
import { useAppWorkflowFieldContext } from '~/lib/workflow/components/app-workflow-field-context'
import { mapFieldToVarEditorProps } from '~/lib/workflow/utils/field-to-var-editor'

/**
 * Helper to get a nested value from an object using dot notation.
 */
function getNestedValue(obj: any, path: string): any {
  const keys = path.split('.')
  let result = obj
  for (const key of keys) {
    result = result?.[key]
  }
  return result
}

/**
 * VarInputInternal — the single host-side component for all app workflow input types.
 *
 * Renders a VarEditor configured for the appropriate BaseType/VarMode.
 * Reads/writes through AppWorkflowFieldContext (no iframe round-trip).
 *
 * This component is used directly by the component registry for:
 * - VarInputInternal (base component)
 * - StringInputInternal, NumberInputInternal, BooleanInputInternal, OptionsInputInternal (aliases)
 */
export const VarInputInternal = ({
  name,
  type,
  placeholder,
  acceptsVariables,
  variableTypes,
  format,
  options,
  multiline,
  expand: _expand,
  variant,
}: {
  name: string
  type: string
  placeholder?: string
  acceptsVariables?: boolean
  variableTypes?: string[]
  format?: string
  options?: readonly (string | { label: string; value: string })[]
  multiline?: boolean
  expand?: boolean // consumed by parent WorkflowVarFieldGroup, ignored here
  variant?: string
}) => {
  const { nodeId, nodeData, handleFieldChange, getFieldMode, schema } = useAppWorkflowFieldContext()

  // Resolve options: explicit prop > schema metadata > empty
  const resolvedOptions = options ?? schema?.inputs?.[name]?.options

  // Resolve acceptsVariables: explicit prop > schema metadata (defaults to false when not set)
  const resolvedAcceptsVariables = acceptsVariables ?? schema?.inputs?.[name]?.acceptsVariables

  const { varType, mode, allowConstant, allowedTypes, fieldOptions } = mapFieldToVarEditorProps({
    type,
    format,
    options: resolvedOptions,
    acceptsVariables: resolvedAcceptsVariables,
    variableTypes,
    variant,
  })

  // Dot-path access for nested fields
  const value = getNestedValue(nodeData, name) ?? ''
  const isConstantMode = getFieldMode(name)

  return (
    <VarEditor
      nodeId={nodeId}
      value={typeof value === 'string' ? value : String(value)}
      onChange={(v, isConstant) => handleFieldChange(name, v, isConstant)}
      varType={varType}
      mode={mode}
      allowConstant={allowConstant}
      allowedTypes={allowedTypes}
      fieldOptions={fieldOptions}
      placeholder={placeholder}
      placeholderConstant={placeholder}
      isConstantMode={isConstantMode}
      onConstantModeChange={(isConstant) => {
        // When toggling mode, update fieldModes without changing the value
        handleFieldChange(name, value, isConstant)
      }}
      hideClearButton
    />
  )
}
