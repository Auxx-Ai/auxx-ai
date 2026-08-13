// packages/lib/src/workflow-engine/catalog/nodes/var-assign.ts

import { generateId } from '@auxx/utils/generateId'
import { z } from 'zod'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createUnifiedOutputVariable } from '../variable-conversion'
import { extractVarIdsFromString } from '../variable-inference'

/**
 * Single variable assignment configuration
 */
export interface VariableAssignment {
  /** Unique identifier for the assignment */
  id: string
  /** Variable name */
  name: string
  /** Variable type (e.g., STRING, NUMBER, BOOLEAN) */
  type: BaseType
  /** Whether this is an array of the specified type */
  isArray?: boolean
  /** Variable value(s) - can be string or array of strings for array type */
  value: string | string[]
  /** Whether this variable is in constant mode (for single values only) */
  isConstantMode?: boolean
  /** Constant mode tracking for each array item (for array values only) */
  itemConstantModes?: boolean[]
}

/**
 * Variable assignment node data (flattened structure)
 */
export interface VarAssignNodeData extends BaseNodeData {
  /** Array of variable assignments */
  variables: VariableAssignment[]
  /** Whether to ignore type errors during execution */
  ignoreTypeError?: boolean
}

/**
 * Zod schema for variable assignment
 */
const variableAssignmentSchema = z.object({
  id: z.string(),
  // Empty is a legitimate PERSISTED state — the canvas default is a blank
  // starter row the user fills in, and half-configured nodes save. Shape
  // constraint here (empty OR a valid identifier); COMPLETENESS lives in
  // `validateVarAssign`, which flags empty names as checklist errors. The
  // legacy min(1) made the default data fail its own schema — caught by the
  // catalog defaults-parse test.
  name: z
    .string()
    .regex(
      /^$|^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Variable name must start with a letter or underscore and contain only alphanumeric characters and underscores'
    ),
  type: z.enum(BaseType),
  isArray: z.boolean().optional(),
  value: z.union([z.string(), z.array(z.string())]),
  isConstantMode: z.boolean().optional(),
  itemConstantModes: z.array(z.boolean()).optional(),
})

/**
 * Zod schema for var-assign node data (flattened structure).
 * Kept as the historical hand-rolled subset (not a baseNodeDataSchema extend)
 * to preserve the exact persisted contract; the `type` literal is the one
 * schema in the set that pins its own node type.
 */
export const varAssignNodeDataSchema = z.object({
  // Base node properties
  id: z.string(),
  type: z.literal('var-assign'),
  // .default(false) aligns with baseNodeDataSchema — the node factory sets it
  selected: z.boolean().default(false),

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
 * Validation function for var-assign configuration
 */
export function validateVarAssign(data: VarAssignNodeData): NodeValidationResult {
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
function getVarAssignOutputVariables(data: VarAssignNodeData, nodeId: string): UnifiedVariable[] {
  // Support both old config format and new flattened format
  const variables = 'config' in data ? (data as any).config.variables : data.variables

  return variables
    .filter((v: VariableAssignment) => v.name.trim())
    .map((variable: VariableAssignment) => {
      // Generate description based on type and isArray
      const typeDescription = variable.isArray ? `Array of ${variable.type}` : variable.type

      // The engine writes an array for `isArray` assignments — advertise it as one, with
      // the declared type as the item type, so the picker offers `<node>.<name>[*]`.
      if (variable.isArray) {
        return createUnifiedOutputVariable({
          nodeId,
          path: variable.name,
          type: BaseType.ARRAY,
          description: `Custom variable of type ${typeDescription}`,
          items: {
            id: `${nodeId}.${variable.name}[*]`,
            type: variable.type,
            label: 'Item',
            category: 'node',
          },
        })
      }

      return createUnifiedOutputVariable({
        nodeId,
        path: variable.name, // Changed from 'name' to 'path'
        type: variable.type,
        description: `Custom variable of type ${typeDescription}`,
      })
    })
}

/**
 * Var-assign node manifest
 */
export const varAssignManifest: NodeManifest<VarAssignNodeData> = {
  id: 'var-assign',
  category: NodeCategory.TRANSFORM,
  displayName: 'Assign Variable',
  description: 'Create custom variables for use in subsequent nodes',
  icon: 'variable',
  color: '#8B5CF6', // TRANSFORM category color
  defaultData: () => ({
    title: 'Assign Variable',
    desc: 'Create custom variables for use in subsequent nodes',
    variables: [{ id: generateId(), name: '', type: BaseType.STRING, value: '' }],
    ignoreTypeError: false,
  }),
  configSchema: varAssignNodeDataSchema as unknown as z.ZodType<VarAssignNodeData>,
  validate: validateVarAssign,
  extractVariables: extractVarAssignVariables,
  resolveOutputs: getVarAssignOutputVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Each entry in `variables` needs a valid identifier `name`, a `type` (BaseType), and a ' +
      '`value` (string, may contain {{…}} refs; string[] with isArray). Names become ' +
      'node-scoped outputs: {{Node Title.<name>}}.',
    examples: [
      {
        description: 'Assign a greeting from an upstream value',
        config: {
          variables: [
            {
              id: 'a1',
              name: 'greeting',
              type: 'string',
              value: 'Hello {{find-1.contact.firstName}}',
            },
          ],
        },
      },
    ],
  },
}
