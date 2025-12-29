// apps/web/src/components/workflow/nodes/core/var-assign/schema.ts

import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import {
  type NodeDefinition,
  NodeCategory,
  type ValidationResult,
} from '~/components/workflow/types'
import { type VarAssignNodeData, type VariableAssignment } from './types'
import { VarAssignPanel } from './panel'
import { NodeType } from '~/components/workflow/types/node-types'
import { BaseType } from '~/components/workflow/types/unified-types'
import { type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'

/**
 * Zod schema for variable assignment
 */
const variableAssignmentSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .min(1, 'Variable name is required')
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Variable name must start with a letter or underscore and contain only alphanumeric characters and underscores'
    ),
  type: z.enum(BaseType),
  isArray: z.boolean().optional(),
  value: z.union([z.string(), z.array(z.string())]),
  isConstantMode: z.boolean().optional(),
  itemConstantModes: z.array(z.boolean()).optional(),
})

/**
 * Zod schema for var-assign configuration
 * @deprecated Use varAssignNodeDataSchema instead
 */
export const varAssignConfigSchema = z.object({
  title: z.string().default('Assign Variable'),
  desc: z.string().optional(),
  variables: z.array(variableAssignmentSchema),
  ignoreTypeError: z.boolean().default(false),
})

/**
 * Zod schema for var-assign node data (flattened structure)
 */
export const varAssignNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal(NodeType.VAR_ASSIGN),
  selected: z.boolean(),

  // Flattened config properties
  title: z.string().default('Assign Variable'),
  desc: z.string().optional(),
  variables: z.array(variableAssignmentSchema),
  ignoreTypeError: z.boolean().default(false),

  // Other node data properties
  isValid: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  disabled: z.boolean().optional(),
  outputVariables: z.array(z.string()).optional(),
})

/**
 * Factory function to create default node data (flattened)
 */
export const createVarAssignDefaultData = (): Partial<VarAssignNodeData> => ({
  title: 'Assign Variable',
  desc: 'Create custom variables for use in subsequent nodes',
  variables: [{ id: uuidv4(), name: '', type: BaseType.STRING, value: '' }],
  ignoreTypeError: false,
})

/**
 * Default data for new var-assign nodes (flattened)
 */
export const varAssignDefaultData = createVarAssignDefaultData()

/**
 * Validation function for var-assign configuration
 */
export function validateVarAssign(data: VarAssignNodeData): ValidationResult {
  try {
    // Support both old config format and new flattened format
    const dataToValidate = 'config' in data ? data : (data as VarAssignNodeData)

    // Additional custom validation
    const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

    // Check for duplicate variable names
    const names = dataToValidate.variables.map((v) => v.name).filter((name) => name.trim())
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    if (duplicates.length > 0) {
      errors.push({
        field: 'variables',
        message: `Duplicate variable names: ${duplicates.join(', ')}`,
        type: 'error',
      })
    }

    // Check for empty variable names
    dataToValidate.variables.forEach((variable, index) => {
      if (!variable.name.trim()) {
        errors.push({
          field: `variables.${index}.name`,
          message: 'Variable name cannot be empty',
          type: 'error',
        })
      }
    })

    if (errors.length > 0) {
      return { isValid: false, errors }
    }

    return { isValid: true, errors: [] }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
          type: 'error' as const,
        })),
      }
    }
    return {
      isValid: false,
      errors: [{ field: 'general', message: 'Invalid configuration', type: 'error' }],
    }
  }
}

/**
 * Extract variables from configuration
 */
export function extractVarAssignVariables(data: VarAssignNodeData): string[] {
  const uniqueVariables = new Set<string>()

  // Support both old config format and new flattened format
  const variables = 'config' in data ? (data as any).config.variables : data.variables

  // Extract variables from each assignment value
  variables.forEach((assignment: VariableAssignment) => {
    const values = Array.isArray(assignment.value) ? assignment.value : [assignment.value]
    values.forEach((val) => {
      extractVarIdsFromString(val).forEach((varId) => {
        uniqueVariables.add(varId)
      })
    })
  })

  return Array.from(uniqueVariables)
}

/**
 * Get output variables for this node
 */
export function getVarAssignOutputVariables(
  data: VarAssignNodeData,
  nodeId: string
): UnifiedVariable[] {
  // Support both old config format and new flattened format
  const variables = 'config' in data ? (data as any).config.variables : data.variables

  return variables
    .filter((v: VariableAssignment) => v.name.trim())
    .map((variable: VariableAssignment) => {
      // Generate description based on type and isArray
      const typeDescription = variable.isArray ? `Array of ${variable.type}` : variable.type

      return createUnifiedOutputVariable({
        nodeId,
        path: variable.name, // Changed from 'name' to 'path'
        type: variable.type,
        description: `Custom variable of type ${typeDescription}`,
      })
    })
}

/**
 * Node definition for var-assign
 */
export const varAssignDefinition: NodeDefinition<VarAssignNodeData> = {
  id: NodeType.VAR_ASSIGN,
  category: NodeCategory.TRANSFORM,
  displayName: 'Assign Variable',
  description: 'Create custom variables for use in subsequent nodes',
  icon: 'variable',
  color: '#8B5CF6', // TRANSFORM category color
  schema: varAssignNodeDataSchema,
  defaultData: varAssignDefaultData,
  canRunSingle: true,
  panel: VarAssignPanel,
  validator: validateVarAssign as any,
  extractVariables: extractVarAssignVariables as any,
  outputVariables: getVarAssignOutputVariables as any,
}
