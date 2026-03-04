// apps/web/src/lib/workflow/utils/resolve-app-outputs.ts

import { schemaRootToWorkflowFields } from '~/components/workflow/utils/schema-to-variable'
import type { WorkflowBlock, WorkflowBlockField } from '../types'

/**
 * Resolve the full set of output fields for an app workflow block.
 * Merges three sources with priority: inferred > computed > static.
 *
 * Used by both WorkflowBlockRegistry (for variable store) and
 * AppWorkflowPanel (for output preview display).
 */
export function resolveAppBlockOutputFields(
  block: WorkflowBlock,
  data?: any
): Record<string, WorkflowBlockField> {
  const staticOutputs = block.schema.outputs || {}
  const computedOutputs = data?._computedOutputs || {}
  const inferredOutputs = data?.inferredSchema
    ? schemaRootToWorkflowFields(data.inferredSchema)
    : {}

  // Priority: inferred (from execution) > computed (from SDK) > static (from schema)
  return { ...staticOutputs, ...computedOutputs, ...inferredOutputs }
}

/**
 * Compute a stable structural signature of output fields.
 * Captures field types and nested shapes, not just top-level keys.
 * Used to detect when _computedOutputs change shape and inferredSchema is stale.
 */
export function computeOutputSignature(outputs: Record<string, WorkflowBlockField>): string {
  const sig = (field: WorkflowBlockField): string => {
    let s = field.type
    if (field.properties) {
      const props = Object.entries(field.properties)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${sig(v)}`)
      s += `{${props.join(',')}}`
    }
    if (field.items) {
      s += `[${sig(field.items)}]`
    }
    return s
  }

  return Object.entries(outputs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${sig(v)}`)
    .join(';')
}
