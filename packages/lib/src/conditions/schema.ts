// packages/lib/src/conditions/schema.ts

import { z } from 'zod'

/**
 * Zod schema for Condition
 * Uses z.lazy() for recursive subConditions reference
 */
export const conditionSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string(),
    fieldId: z.union([
      z.string(),
      z.array(z.string())
    ]),
    operator: z.string(),
    value: z.any(),
    logicalOperator: z.enum(['AND', 'OR']).optional(),
    isConstant: z.boolean().optional(),
    key: z.string().optional(),
    subConditions: z.array(conditionSchema).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    numberVarType: z.enum(['string', 'number']).optional(),
    variableId: z.string().optional(),
  })
)

/**
 * Zod schema for ConditionGroup
 */
export const conditionGroupSchema = z.object({
  id: z.string(),
  conditions: z.array(conditionSchema),
  logicalOperator: z.enum(['AND', 'OR']),
  metadata: z.record(z.string(), z.any()).optional(),
  order: z.number().optional(),
  case_id: z.string().optional(),
})

/**
 * Zod schema for array of condition groups
 */
export const conditionGroupsSchema = z.array(conditionGroupSchema)
