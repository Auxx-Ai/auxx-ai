// apps/web/src/components/workflow/nodes/core/text-classifier/schema.ts

import { type NodeManifest, textClassifierManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { TextClassifierNodeData } from './types'

// The data half (config types, zod schema, defaults, validator, variable
// extraction, output resolver — and the category-branch derivation as
// `connection.branches`) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/text-classifier`). This file is
// the merge site: manifest + the React parts.

/** Node definition for text classifier */
export const textClassifierDefinition: NodeDefinition<TextClassifierNodeData> = defineFromManifest(
  textClassifierManifest as unknown as NodeManifest<TextClassifierNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  textClassifierSchema,
  validateTextClassifierData,
} from '@auxx/lib/workflow-engine/client'

/**
 * Factory function to create a new text classifier default data
 * This ensures each node gets its own deep copy of the data
 */
export const createTextClassifierDefaultData = (): Partial<TextClassifierNodeData> =>
  textClassifierManifest.defaultData() as Partial<TextClassifierNodeData>
