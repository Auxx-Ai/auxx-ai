// apps/web/src/components/workflow/nodes/core/code/schema.ts

import {
  codeManifest,
  type NodeManifest,
  normalizeCodeOutputType,
} from '@auxx/lib/workflow-engine/client'
import { BaseType, type NodeDefinition, type UnifiedVariable } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { CodeNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extraction) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/code`). This file is the merge
// site: manifest + the web-only output resolver.

/**
 * Define output variables for code node.
 *
 * Drift fix (node-catalog Phase 1, plan §6): this used to read
 * `output.type?.type` — an object shape only the legacy `CodeOutput` map ever
 * used — while the output editor writes a plain `BaseType` string, so every
 * output resolved as STRING regardless of what the user picked.
 * `normalizeCodeOutputType` reads the string first and tolerates the legacy
 * object shape. User-visible: code-node outputs now show their configured type
 * in the variable picker.
 */
const getCodeOutputVariables = (data: CodeNodeData, nodeId: string): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Use new outputs format if available
  if (data.outputs && Array.isArray(data.outputs)) {
    data.outputs.forEach((output) => {
      outputs.push(
        createUnifiedOutputVariable({
          nodeId,
          path: output.name,
          type: normalizeCodeOutputType(output.type),
          description: output.description || `Output: ${output.name}`,
        })
      )
    })
  } else {
    // Default output if no outputs defined
    outputs.push(
      createUnifiedOutputVariable({
        nodeId,
        path: 'output1',
        type: BaseType.OBJECT,
        description: 'Result from code execution',
      })
    )
  }

  return outputs
}

/** Node definition for code */
export const codeDefinition: NodeDefinition<CodeNodeData> = defineFromManifest(
  codeManifest as unknown as NodeManifest<CodeNodeData>,
  { outputVariables: getCodeOutputVariables }
)

// Back-compat re-exports so no consumer import churns:
export {
  codeNodeDataSchema,
  extractCodeVariables,
  validateCodeConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default data for new code nodes (flattened) */
export const codeDefaultData = codeManifest.defaultData() as Partial<CodeNodeData>
