// apps/web/src/components/workflow/ui/conditions/components/condition-value.tsx

'use client'

import { memo, useMemo } from 'react'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { useConditionContext } from '../condition-context'
import { STANDARD_OPERATORS, type Operator } from '../types'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'

type ConditionValueProps = {
  fieldId?: string
  operator: Operator
  value: string | string[] | TiptapJSON | number | boolean
  nodeId?: string
  className?: string
}

/**
 * Generic condition value display component
 */
const ConditionValue = ({ fieldId, operator, value, nodeId, className }: ConditionValueProps) => {
  const { config, getFieldDefinition } = useConditionContext()

  const operatorDef = STANDARD_OPERATORS[operator]
  const operatorName = operatorDef?.label || operator
  const notHasValue = operatorDef ? !operatorDef.requiresValue : false

  const fieldDef = useMemo(() => {
    return fieldId ? getFieldDefinition(fieldId) : undefined
  }, [fieldId, getFieldDefinition])

  const formatValue = useMemo(() => {
    if (notHasValue) return ''

    if (Array.isArray(value)) {
      // For multiple values (like "in" operator)
      return value.join(', ')
    }

    // Handle string values with variable replacement
    if (typeof value === 'string') {
      // For new format, just display the variable path
      return value.replace(/{{([^}]+)}}/g, (_match, variablePath) => variablePath)
    }

    // Handle other value types
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }

    if (typeof value === 'number') {
      return value.toString()
    }

    return String(value)
  }, [notHasValue, value])

  return (
    <div className={`flex h-6 items-center gap-1 rounded-md bg-muted px-1 ${className || ''}`}>
      {/* Field identifier - show variable tag for variable mode, field label for resource mode */}
      {fieldId && config.mode === 'variable' && (
        <VariableTag variableId={fieldId} nodeId={nodeId} isShort />
      )}
      {fieldId && config.mode === 'resource' && fieldDef && (
        <div className="shrink-0 text-xs font-medium text-primary-500" title={fieldDef.label}>
          {fieldDef.label}
        </div>
      )}

      {/* Operator */}
      <div className="shrink-0 text-xs font-medium text-primary-500" title={operatorName}>
        {operatorName}
      </div>

      {/* Value */}
      {!notHasValue && (
        <div className="shrink-[3] truncate text-xs text-primary-500" title={formatValue}>
          {formatValue}
        </div>
      )}
    </div>
  )
}

export default memo(ConditionValue)
