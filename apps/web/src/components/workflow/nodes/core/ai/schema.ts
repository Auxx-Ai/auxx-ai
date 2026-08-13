// apps/web/src/components/workflow/nodes/core/ai/schema.ts

import { aiManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { AiNodeData } from './types'

// The data half (enums, model-config vocabulary, data interface, zod schema,
// defaults, validator, variable extraction, output resolver) lives in the
// node catalog (`@auxx/lib/workflow-engine/catalog/nodes/ai`). This file is
// the merge site: manifest + the React parts.

/** Node definition for AI */
export const aiDefinition: NodeDefinition<AiNodeData> = defineFromManifest(
  aiManifest as unknown as NodeManifest<AiNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  aiNodeDataSchema,
  extractAIVariableIds,
  validateAiData,
} from '@auxx/lib/workflow-engine/client'

/** Factory function to create a new AI default configuration */
export function createAiDefaultData(): Partial<AiNodeData> {
  return aiManifest.defaultData() as Partial<AiNodeData>
}
