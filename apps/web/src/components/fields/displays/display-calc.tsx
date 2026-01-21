// apps/web/src/components/fields/displays/display-calc.tsx
'use client'

import { useMemo } from 'react'
import DisplayWrapper from './display-wrapper'
import { useFieldContext } from './display-field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { AlertCircle } from 'lucide-react'
import { evaluateCalcExpression } from '@auxx/utils/calc-expression'
import {
  useFieldValueStore,
  buildFieldValueKey,
} from '~/components/resources/store/field-value-store'
import type { CalcOptions } from '@auxx/lib/custom-fields/client'
import { Skeleton } from '@auxx/ui/components/skeleton'

/**
 * DisplayCalc component.
 * Renders a calculated field value by evaluating an expression with source field values.
 */
export function DisplayCalc() {
  const { field, recordId } = useFieldContext()
  const calcOptions = field.options?.calc as CalcOptions | undefined
  console.log(field)
  // Check if field is disabled
  if (calcOptions?.disabled) {
    return (
      <DisplayWrapper>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-muted-foreground italic">
              <AlertCircle className="size-3" />
              Calculation unavailable
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {calcOptions.disabledReason || 'This calculated field has been disabled'}
          </TooltipContent>
        </Tooltip>
      </DisplayWrapper>
    )
  }

  // If no calc options or no expression, show empty
  if (!calcOptions?.expression) {
    return <DisplayWrapper className="text-muted-foreground">-</DisplayWrapper>
  }

  // sourceFields is Record<placeholderName, fieldId>
  const sourceFieldsMap = calcOptions.sourceFields ?? {}
  const placeholderNames = Object.keys(sourceFieldsMap)

  // Subscribe to source field values from the store
  const { sourceValues, loadingCount } = useFieldValueStore((state) => {
    if (placeholderNames.length === 0) return { sourceValues: {}, loadingCount: 0 }

    const values: Record<string, unknown> = {}
    let loading = 0

    for (const [placeholder, fieldId] of Object.entries(sourceFieldsMap)) {
      const key = buildFieldValueKey(recordId, fieldId)
      const storedValue = state.values[key]

      // Extract raw value from TypedFieldValue
      if (storedValue && typeof storedValue === 'object' && 'type' in storedValue) {
        const typed = storedValue as {
          type: string
          value?: unknown
          optionId?: string
          label?: string
        }
        switch (typed.type) {
          case 'text':
          case 'number':
          case 'boolean':
          case 'date':
            values[placeholder] = typed.value
            break
          case 'option':
            values[placeholder] = typed.label ?? typed.optionId
            break
          default:
            values[placeholder] = typed.value ?? null
        }
      } else {
        values[placeholder] = storedValue
      }

      if (state.isKeyLoading(key)) loading++
    }

    return { sourceValues: values, loadingCount: loading }
  })

  // Compute the CALC field value
  const computedValue = useMemo(() => {
    if (!calcOptions?.expression) return null

    // Check if all source values are loaded (not undefined)
    const allLoaded = placeholderNames.every((name) => sourceValues[name] !== undefined)
    if (!allLoaded) return undefined // Still loading

    return evaluateCalcExpression(calcOptions.expression, sourceValues)
  }, [calcOptions, placeholderNames, sourceValues])

  // Handle loading state
  if (loadingCount > 0 || computedValue === undefined) {
    return (
      <DisplayWrapper>
        <Skeleton className="h-4 w-16" />
      </DisplayWrapper>
    )
  }

  // Format based on result field type
  const displayValue = useMemo(() => {
    if (computedValue == null) return null

    const resultType = calcOptions?.resultFieldType ?? 'TEXT'
    switch (resultType) {
      case 'NUMBER':
        const num = Number(computedValue)
        if (isNaN(num)) return null
        return num.toLocaleString()

      case 'CURRENCY':
        const currencyNum = Number(computedValue)
        if (isNaN(currencyNum)) return null
        // Use basic currency formatting - could be enhanced with currency options
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(currencyNum)

      case 'CHECKBOX':
        return computedValue ? 'Yes' : 'No'

      case 'TEXT':
      default:
        return String(computedValue)
    }
  }, [computedValue, calcOptions?.resultFieldType])

  if (displayValue == null) {
    return <DisplayWrapper className="text-muted-foreground">-</DisplayWrapper>
  }

  return <DisplayWrapper copyValue={String(displayValue)}>{displayValue}</DisplayWrapper>
}
