// apps/web/src/components/workflow/nodes/core/date-time/schema.ts

import { z } from 'zod'
import { NodeType } from '~/components/workflow/types/node-types'
import { NodeCategory } from '~/components/workflow/types/registry'
import type { NodeDefinition, ValidationResult } from '~/components/workflow/types/registry'
import { BaseType } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { DateTimePanel } from './panel'
import {
  DateTimeOperation,
  TimeUnit,
  DateFormatType,
  ParseDateFormatType,
  type DateTimeNodeData,
} from './types'
import { DEFAULT_DURATION, DEFAULT_PARSE_FORMAT_TYPE } from './constants'

/**
 * Zod schema for date-time node validation
 */
export const dateTimeNodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  operation: z.enum(DateTimeOperation),

  // Shared fields
  inputDate: z.string().min(1, 'Input date is required'),
  isInputDateConstant: z.boolean().default(true),

  // Operation-specific fields
  addSubtract: z
    .object({
      action: z.enum(['add', 'subtract']),
      duration: z.number().min(0, 'Duration must be positive'),
      unit: z.enum(TimeUnit),
    })
    .optional(),

  format: z
    .object({ type: z.enum(DateFormatType), customFormat: z.string().optional() })
    .optional(),

  timeBetween: z
    .object({
      endDate: z.string(),
      isEndDateConstant: z.boolean().default(true),
      unit: z.enum(TimeUnit),
    })
    .optional(),

  round: z
    .object({ direction: z.enum(['up', 'down', 'nearest']), unit: z.enum(TimeUnit) })
    .optional(),

  parseDate: z
    .object({
      formatType: z.nativeEnum(ParseDateFormatType),
      customFormat: z.string().optional(),
    })
    .optional(),

  // Additional settings
  timezone: z.string().optional(),
  locale: z.string().optional(),
  outputAsTimestamp: z.boolean().optional(),
})

/**
 * Default data factory
 */
export function createDateTimeNodeDefaultData(): Partial<DateTimeNodeData> {
  return {
    title: 'Date Time',
    operation: DateTimeOperation.ADD_SUBTRACT,
    isInputDateConstant: true,
    addSubtract: { action: 'add', duration: DEFAULT_DURATION, unit: TimeUnit.DAYS },
    timeBetween: { unit: TimeUnit.DAYS, isEndDateConstant: true },
    parseDate: { formatType: DEFAULT_PARSE_FORMAT_TYPE },
  }
}

/**
 * Data validator
 */
export function validateDateTimeNodeData(data: DateTimeNodeData): ValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // try {
  //   dateTimeNodeSchema.parse(data)
  // } catch (error) {
  //   if (error instanceof z.ZodError) {
  //     error.errors.forEach((err) => {
  //       errors.push({ field: err.path.join('.'), message: err.message, type: 'error' })
  //     })
  //   }
  // }

  // Additional validation
  switch (data.operation) {
    case DateTimeOperation.ADD_SUBTRACT:
      if (!data.addSubtract) {
        errors.push({
          field: 'addSubtract',
          message: 'Add/subtract configuration is required',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.FORMAT:
      if (!data.format) {
        errors.push({ field: 'format', message: 'Format configuration is required', type: 'error' })
      } else if (data.format.type === DateFormatType.CUSTOM && !data.format.customFormat) {
        errors.push({
          field: 'format.customFormat',
          message: 'Custom format string is required',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.TIME_BETWEEN:
      if (!data.timeBetween) {
        errors.push({
          field: 'timeBetween',
          message: 'Time between configuration is required',
          type: 'error',
        })
      } else if (!data.timeBetween.endDate) {
        errors.push({
          field: 'timeBetween.endDate',
          message: 'End date is required for time between operation',
          type: 'error',
        })
      }
      break
    case DateTimeOperation.ROUND:
      if (!data.round) {
        errors.push({ field: 'round', message: 'Round configuration is required', type: 'error' })
      }
      break
    case DateTimeOperation.PARSE_DATE:
      if (!data.parseDate) {
        errors.push({
          field: 'parseDate',
          message: 'Parse date configuration is required',
          type: 'error',
        })
      } else if (
        data.parseDate.formatType === ParseDateFormatType.CUSTOM &&
        !data.parseDate.customFormat
      ) {
        errors.push({
          field: 'parseDate.customFormat',
          message: 'Custom format string is required',
          type: 'error',
        })
      }
      break
  }

  // Validate that inputDate is provided for all operations
  if (!data.inputDate) {
    errors.push({ field: 'inputDate', message: 'Input date is required', type: 'error' })
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Variable extraction
 */
export function extractDateTimeNodeVariables(data: DateTimeNodeData): string[] {
  const variables: string[] = []

  // Extract from main input date only if it's not a constant
  if (data.inputDate && !data.isInputDateConstant) {
    variables.push(data.inputDate)
  }

  // Extract from time between end date only if it's not a constant
  if (
    data.operation === DateTimeOperation.TIME_BETWEEN &&
    data.timeBetween?.endDate &&
    !data.timeBetween?.isEndDateConstant
  ) {
    variables.push(data.timeBetween.endDate)
  }

  return [...new Set(variables)]
}

/**
 * Output variables definition
 */
export function getDateTimeNodeOutputVariables(data: DateTimeNodeData, nodeId: string): any[] {
  switch (data.operation) {
    case DateTimeOperation.ADD_SUBTRACT:
    case DateTimeOperation.ROUND:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result', // Changed from 'name' to 'path'
          type: BaseType.DATETIME,
          description: 'Modified date/time',
        }),
      ]

    case DateTimeOperation.FORMAT:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result', // Changed from 'name' to 'path'
          type: BaseType.STRING,
          description: 'Formatted date string',
        }),
      ]

    case DateTimeOperation.TIME_BETWEEN:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result', // Changed from 'name' to 'path'
          type: BaseType.NUMBER,
          description: `Duration in ${data.timeBetween?.unit || 'days'}`,
        }),
      ]

    case DateTimeOperation.PARSE_DATE:
      return [
        createUnifiedOutputVariable({
          nodeId,
          path: 'result', // Changed from 'name' to 'path'
          type: BaseType.DATETIME,
          description: 'Parsed date object',
        }),
      ]

    default:
      return []
  }
}

/**
 * Node definition
 */
export const dateTimeNodeDefinition: NodeDefinition<DateTimeNodeData> = {
  id: NodeType.DATE_TIME,
  category: NodeCategory.UTILITY,
  displayName: 'Date Time',
  description: 'Perform various date and time operations',
  icon: 'calendar',
  color: '#3B82F6', // UTILITY category color
  defaultData: createDateTimeNodeDefaultData(),
  schema: dateTimeNodeSchema,
  panel: DateTimePanel,
  validator: validateDateTimeNodeData,
  canRunSingle: true,
  extractVariables: extractDateTimeNodeVariables,
  outputVariables: getDateTimeNodeOutputVariables,
}
