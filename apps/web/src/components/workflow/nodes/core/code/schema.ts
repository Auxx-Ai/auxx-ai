// apps/web/src/components/workflow/nodes/core/code/schema.ts

import { codeManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { CodeNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/code`). This file is the merge
// site: manifest + the React parts.

/** Node definition for code */
export const codeDefinition: NodeDefinition<CodeNodeData> = defineFromManifest(
  codeManifest as unknown as NodeManifest<CodeNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  codeNodeDataSchema,
  extractCodeVariables,
  validateCodeConfig,
} from '@auxx/lib/workflow-engine/client'

/** Default data for new code nodes (flattened) */
export const codeDefaultData = codeManifest.defaultData() as Partial<CodeNodeData>
