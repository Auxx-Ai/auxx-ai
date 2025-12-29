// apps/web/src/components/workflow/nodes/if-else/components/condition-value.tsx

import { memo, useMemo } from 'react'
import type { NodeCondition } from '../types'
import VariableTag from '~/components/workflow/ui/variables/variable-tag'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor'

export type ValueSelector = string[] // [nodeId, key | obj key path]

export const isSystemVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'sys' || valueSelector[1] === 'sys'
}

export const isENV = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'env'
}

export const isConversationVar = (valueSelector: ValueSelector) => {
  return valueSelector[0] === 'conversation'
}

export type ComparisonOperator = NodeCondition['comparison_operator']

// Operator display names for better readability
const OPERATOR_DISPLAY_MAP: Record<string, string> = {
  contains: 'contains',
  'not contains': 'does not contain',
  'starts with': 'starts with',
  'ends with': 'ends with',
  is: 'is',
  'is not': 'is not',
  empty: 'is empty',
  'not empty': 'is not empty',
  '=': 'equals',
  '!=': 'not equals',
  '>': 'greater than',
  '<': 'less than',
  '>=': 'greater than or equal',
  '<=': 'less than or equal',
  in: 'is in',
  'not in': 'is not in',
  exists: 'exists',
  'not exists': 'does not exist',
  // Enhanced file operators
  is_valid: 'is valid',
  is_invalid: 'is invalid',
  uploaded_today: 'uploaded today',
  uploaded_within_days: 'uploaded within days',
  matches_pattern: 'matches pattern',
  contains_numbers: 'contains numbers',
  contains_date: 'contains date',
  has_version: 'has version',
  is_office_document: 'is office document',
  is_image_format: 'is image format',
  is_text_format: 'is text format',
  is_compressed: 'is compressed',
  is_executable: 'is executable',
  within_size_limit: 'within size limit',
  exceeds_limit: 'exceeds limit',
  before: 'before',
  after: 'after',
  on: 'on',
  within_days: 'within days',
  older_than_days: 'older than days',
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
  this_month: 'this month',
}

export const comparisonOperatorNotRequireValue = (operator?: ComparisonOperator) => {
  if (!operator) return false

  const noValueOperators = [
    'empty',
    'not empty',
    'exists',
    'not exists',
    // Enhanced file operators that don't need values
    'is_valid',
    'is_invalid',
    'uploaded_today',
    'contains_numbers',
    'contains_date',
    'has_version',
    'is_office_document',
    'is_image_format',
    'is_text_format',
    'is_compressed',
    'is_executable',
    'today',
    'yesterday',
    'this_week',
    'this_month',
  ]

  return noValueOperators.includes(operator)
}

type ConditionValueProps = {
  variableId?: string
  operator: ComparisonOperator
  value: string | string[] | TiptapJSON
  editorContent?: TiptapJSON
  nodeId?: string
}
const ConditionValue = ({ variableId, operator, value, nodeId }: ConditionValueProps) => {
  const operatorName = operator ? OPERATOR_DISPLAY_MAP[operator] || operator : ''
  const notHasValue = comparisonOperatorNotRequireValue(operator)

  const formatValue = useMemo(() => {
    if (notHasValue) return ''

    if (Array.isArray(value)) {
      // transfer method
      return value[0]
    }

    // Handle string values
    if (typeof value === 'string') {
      // For new format, just display the variable path
      return value.replace(/{{([^}]+)}}/g, (_match, variablePath) => variablePath)
    }

    return String(value)
  }, [notHasValue, value])

  return (
    <div className="flex h-6 items-center gap-1 rounded-md bg-muted px-1">
      {variableId && <VariableTag variableId={variableId} nodeId={nodeId} isShort />}
      <div className="shrink-0 text-xs font-medium text-primary-500" title={operatorName}>
        {operatorName}
      </div>
      {!notHasValue && (
        <div className="shrink-[3] truncate text-xs text-primary-500" title={formatValue}>
          {formatValue}
        </div>
      )}
    </div>
  )
}

export default memo(ConditionValue)
