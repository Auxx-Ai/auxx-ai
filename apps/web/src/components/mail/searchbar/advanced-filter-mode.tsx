// apps/web/src/components/mail/searchbar/advanced-filter-mode.tsx
'use client'

import {
  getOperatorDefinition,
  type Operator,
  operatorRequiresValue,
} from '@auxx/lib/conditions/client'
import {
  getDefaultOperatorForField,
  getMailViewFieldDefinition,
  MAIL_VIEW_FIELD_DEFINITIONS,
} from '@auxx/lib/mail-views/client'
import { Button } from '@auxx/ui/components/button'
import { Label } from '@auxx/ui/components/label'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo, useState } from 'react'
import { v4 as generateId } from 'uuid'
import ConditionOperator from '~/components/conditions/components/condition-operator'
import { ConditionProvider } from '~/components/conditions/condition-context'
import { ResourceInput } from '~/components/conditions/inputs/resource-input'
import type { Condition, ConditionSystemConfig } from '~/components/conditions/types'
import type { SearchCondition } from './store'

interface AdvancedFilterModeProps {
  initialConditions?: SearchCondition[]
  onApply: (conditions: SearchCondition[]) => void
  onCancel: () => void
  className?: string
}

/** Fields excluded from the filter form */
const EXCLUDED_FIELDS = new Set(['freeText', 'sender'])

/** Default operators per field (overrides the field-definition default) */
const DEFAULT_OPERATORS: Record<string, Operator> = {
  from: 'contains',
  to: 'contains',
  tag: 'in',
  assignee: 'in',
  inbox: 'in',
  subject: 'contains',
  body: 'contains',
  status: 'is',
  date: 'on_date',
  hasAttachments: 'is',
}

function getConditionValue(conditions: SearchCondition[], fieldId: string): any {
  return conditions.find((c) => c.fieldId === fieldId)?.value
}

function getConditionOperator(
  conditions: SearchCondition[],
  fieldId: string,
  defaultOp: Operator
): Operator {
  return conditions.find((c) => c.fieldId === fieldId)?.operator ?? defaultOp
}

function setConditionValue(
  conditions: SearchCondition[],
  fieldId: string,
  operator: Operator,
  value: any
): SearchCondition[] {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)

  // For no-value operators, keep the condition even without a value
  if (isEmpty && operatorRequiresValue(operator)) {
    return conditions.filter((c) => c.fieldId !== fieldId)
  }

  const existingIndex = conditions.findIndex((c) => c.fieldId === fieldId)
  const condition: SearchCondition = {
    id: existingIndex !== -1 ? conditions[existingIndex]!.id : generateId(),
    fieldId,
    operator,
    value: isEmpty ? undefined : value,
  }

  if (existingIndex !== -1) {
    const updated = [...conditions]
    updated[existingIndex] = condition
    return updated
  }

  return [...conditions, condition]
}

function isMultiOperator(op: Operator): boolean {
  const def = getOperatorDefinition(op)
  return def?.valueType === 'multiple'
}

export function AdvancedFilterMode({
  initialConditions = [],
  onApply,
  onCancel,
  className,
}: AdvancedFilterModeProps) {
  const [conditions, setConditions] = useState<SearchCondition[]>(initialConditions)

  const filterFields = useMemo(
    () => MAIL_VIEW_FIELD_DEFINITIONS.filter((f) => !EXCLUDED_FIELDS.has(f.id)),
    []
  )

  const conditionConfig = useMemo(
    (): ConditionSystemConfig => ({
      mode: 'resource',
      fields: filterFields as any[],
    }),
    [filterFields]
  )

  const updateField = (fieldId: string, operator: Operator, value: any) => {
    setConditions((prev) => setConditionValue(prev, fieldId, operator, value))
  }

  const handleOperatorChange = (fieldId: string, newOperator: Operator) => {
    setConditions((prev) => {
      const existing = prev.find((c) => c.fieldId === fieldId)
      const oldOperator = existing?.operator
      let newValue = existing?.value

      if (!operatorRequiresValue(newOperator)) {
        newValue = undefined
      } else if (oldOperator && isMultiOperator(oldOperator) && !isMultiOperator(newOperator)) {
        if (Array.isArray(newValue)) {
          newValue = newValue[0] ?? undefined
        }
      } else if (oldOperator && !isMultiOperator(oldOperator) && isMultiOperator(newOperator)) {
        if (!Array.isArray(newValue) && newValue !== undefined && newValue !== '') {
          newValue = [newValue]
        } else if (!Array.isArray(newValue)) {
          newValue = []
        }
      }

      // Always persist the condition so the operator selection sticks,
      // even when there's no value yet
      const existingIndex = prev.findIndex((c) => c.fieldId === fieldId)
      const condition: SearchCondition = {
        id: existingIndex !== -1 ? prev[existingIndex]!.id : generateId(),
        fieldId,
        operator: newOperator,
        value: newValue,
      }

      if (existingIndex !== -1) {
        const updated = [...prev]
        updated[existingIndex] = condition
        return updated
      }

      return [...prev, condition]
    })
  }

  const activeConditions = conditions.filter(
    (c) =>
      !operatorRequiresValue(c.operator) ||
      (c.value !== undefined &&
        c.value !== null &&
        c.value !== '' &&
        !(Array.isArray(c.value) && c.value.length === 0))
  )
  const hasActiveFilters = activeConditions.length > 0

  return (
    <div className={cn('space-y-3 p-4', className)}>
      <ConditionProvider
        conditions={[]}
        config={conditionConfig}
        onConditionsChange={() => {}}
        getFieldDefinition={(fieldId) => {
          const id = typeof fieldId === 'string' ? fieldId : fieldId[0]
          return id ? (getMailViewFieldDefinition(id) as any) : undefined
        }}>
        {filterFields.map((field) => {
          const defaultOp = DEFAULT_OPERATORS[field.id] ?? getDefaultOperatorForField(field.id)
          const currentOperator = getConditionOperator(conditions, field.id, defaultOp)
          const value = getConditionValue(conditions, field.id)
          const showValue = operatorRequiresValue(currentOperator)

          const syntheticCondition: Condition = {
            id: field.id,
            fieldId: field.id,
            operator: currentOperator,
            value: value ?? '',
            isConstant: true,
          }

          return (
            <div key={field.id} className='flex items-center gap-2'>
              <Label className='w-30 shrink-0 text-sm text-right'>{field.label}</Label>
              <div className='w-20'>
                <ConditionOperator
                  fieldId={field.id}
                  value={currentOperator}
                  onChange={(op) => handleOperatorChange(field.id, op)}
                  triggerProps={{ size: 'sm' }}
                />
              </div>
              {showValue ? (
                <div className='flex-1 min-h-8'>
                  <ResourceInput
                    condition={syntheticCondition}
                    field={field}
                    value={value}
                    onChange={(newValue) => updateField(field.id, currentOperator, newValue)}
                    placeholder={field.placeholder}
                    triggerProps={{
                      className: 'w-full border px-2 border-1! border-solid rounded-xl text-xs',
                      size: 'sm',
                    }}
                  />
                </div>
              ) : (
                <div className='flex-1 min-h-8' />
              )}
            </div>
          )
        })}
      </ConditionProvider>

      {/* Actions */}
      <div className='flex items-center justify-between border-t pt-4'>
        <div>
          {hasActiveFilters && (
            <Button variant='ghost' size='sm' onClick={() => setConditions([])}>
              Clear All
            </Button>
          )}
        </div>
        <div className='flex gap-2'>
          <Button variant='ghost' size='sm' onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onApply(conditions)} size='sm'>
            Apply Filters
            {hasActiveFilters && (
              <span className='rounded bg-white/30 px-1.5 py-0.5 text-xs text-background'>
                {activeConditions.length}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
