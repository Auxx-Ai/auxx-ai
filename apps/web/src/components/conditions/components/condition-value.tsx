// apps/web/src/components/conditions/components/condition-value.tsx

'use client'

import { memo, useMemo } from 'react'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import { useConditionContext } from '../condition-context'
import { type Operator, STANDARD_OPERATORS } from '../types'

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
      return value.join(', ')
    }

    if (typeof value === 'string') {
      return value.replace(/{{([^}]+)}}/g, (_match, variablePath) => variablePath)
    }

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
      {fieldId && config.mode === 'variable' && (
        <VariableTag variableId={fieldId} nodeId={nodeId} isShort />
      )}
      {fieldId && config.mode === 'resource' && fieldDef && (
        <div className='shrink-0 text-xs font-medium text-primary-500' title={fieldDef.label}>
          {fieldDef.label}
        </div>
      )}

      <div className='shrink-0 text-xs font-medium text-primary-500' title={operatorName}>
        {operatorName}
      </div>

      {!notHasValue && (
        <div className='shrink-[3] truncate text-xs text-primary-500' title={formatValue}>
          {formatValue}
        </div>
      )}
    </div>
  )
}

export default memo(ConditionValue)
