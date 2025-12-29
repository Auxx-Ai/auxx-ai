// packages/sdk/src/root/workflow/values/transform.ts

import type { TransformationContext } from './types.js'
import type { WorkflowFieldNode } from '../base-node.js'

/**
 * Transform a schema object's values to config format
 */
export async function transformSchemaToConfig(
  schema: Record<string, WorkflowFieldNode>,
  data: Record<string, any>,
  context: TransformationContext
): Promise<Record<string, any>> {
  const result: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    if (key in data) {
      result[key] = await field.toConfig(data[key], context)
    }
  }

  return result
}

/**
 * Transform a schema object's values to runtime format
 */
export async function transformSchemaToRuntime(
  schema: Record<string, WorkflowFieldNode>,
  data: Record<string, any>,
  context: TransformationContext
): Promise<Record<string, any>> {
  const result: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    if (key in data) {
      result[key] = await field.toRuntimeValue(data[key], context)
    }
  }

  return result
}

/**
 * Serialize schema values for iframe communication
 */
export function serializeSchemaValues(
  schema: Record<string, WorkflowFieldNode>,
  data: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    if (key in data) {
      result[key] = field.serialize(data[key])
    }
  }

  return result
}

/**
 * Deserialize schema values from iframe communication
 */
export function deserializeSchemaValues(
  schema: Record<string, WorkflowFieldNode>,
  data: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, field] of Object.entries(schema)) {
    if (key in data) {
      result[key] = field.deserialize(data[key])
    }
  }

  return result
}
