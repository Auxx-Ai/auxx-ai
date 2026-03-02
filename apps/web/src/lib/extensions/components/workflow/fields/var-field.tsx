// apps/web/src/lib/extensions/components/workflow/fields/var-field.tsx

'use client'

import React from 'react'
import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { useAppWorkflowFieldContext } from '~/lib/workflow/components/app-workflow-field-context'
import { mapFieldType } from '~/lib/workflow/utils/field-to-var-editor'

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
 * Extract the `name` prop from the first child element.
 * Returns undefined if child doesn't have a name prop.
 */
function extractChildName(children: React.ReactNode): string | undefined {
  const child = React.Children.toArray(children)[0]
  if (React.isValidElement(child) && typeof (child.props as any)?.name === 'string') {
    return (child.props as any).name
  }
  return undefined
}

/**
 * WorkflowVarField — host component that wraps VarEditorFieldRow.
 *
 * Provides the label, description, type icon, required badge, and clear button chrome
 * around child input components.
 *
 * Resolution order: explicit prop > schema metadata > fallback default
 */
export const WorkflowVarField = ({
  name,
  title,
  description,
  required,
  type,
  showIcon,
  children,
}: {
  name?: string
  title?: string
  description?: string
  required?: boolean
  type?: string
  showIcon?: boolean
  children: React.ReactNode
}) => {
  const { nodeData, handleFieldChange, schema } = useAppWorkflowFieldContext()

  // Resolve field name: explicit prop > child's name prop
  const fieldName = name ?? extractChildName(children)
  const fieldSchema = fieldName ? schema?.inputs?.[fieldName] : undefined

  // Resolution order: explicit prop > schema metadata > fallback
  const resolvedTitle = title ?? fieldSchema?.label ?? fieldName ?? ''
  const resolvedDescription = description ?? fieldSchema?.description
  const resolvedRequired = required ?? fieldSchema?.required
  const resolvedType = type
    ? mapFieldType(type)
    : mapFieldType(fieldSchema?.type, fieldSchema?.format)

  const value = fieldName ? getNestedValue(nodeData, fieldName) : undefined
  const hasValue = value !== undefined && value !== '' && value !== null

  return (
    <VarEditorFieldRow
      title={resolvedTitle}
      description={resolvedDescription}
      type={resolvedType}
      isRequired={resolvedRequired}
      showIcon={showIcon}
      onClear={hasValue && fieldName ? () => handleFieldChange(fieldName, '', true) : undefined}>
      {children}
    </VarEditorFieldRow>
  )
}
