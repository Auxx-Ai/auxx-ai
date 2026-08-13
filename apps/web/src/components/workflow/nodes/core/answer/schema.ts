// apps/web/src/components/workflow/nodes/core/answer/schema.ts

import { answerManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { AnswerNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/answer`). This file is the merge
// site: manifest + the React parts.

/** Node definition for answer */
export const answerDefinition: NodeDefinition<AnswerNodeData> = defineFromManifest(
  answerManifest as unknown as NodeManifest<AnswerNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  answerNodeDataSchema,
  extractAnswerVariables,
  validateAnswerConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default configuration for new answer nodes */
export const answerDefaultData = answerManifest.defaultData() as Partial<AnswerNodeData>
