// apps/web/src/components/workflow/nodes/core/text-classifier/schema.ts

import { type NodeManifest, textClassifierManifest } from '@auxx/lib/workflow-engine/client'
import { BaseType, type NodeDefinition } from '~/components/workflow/types'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { TextClassifierNodeData } from './types'

// The data half (config types, zod schema, defaults, validator, variable
// extraction — and the category-branch derivation as `connection.branches`)
// lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/text-classifier`). This file is
// the merge site: manifest + the web-only output resolver.

/**
 * Define output variables for text classifier node
 */
const getTextClassifierOutputVariables = (data: TextClassifierNodeData, nodeId: string): any[] => {
  // Create enum type from categories
  const categoryNames = data?.categories?.map((c) => c.name) || []

  return [
    createUnifiedOutputVariable({
      nodeId,
      path: 'category',
      type: categoryNames.length > 0 ? BaseType.ENUM : BaseType.STRING,
      description: 'The matched category name',
      enum: categoryNames.length > 0 ? categoryNames : undefined,
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'confidence',
      type: BaseType.NUMBER,
      description: 'Confidence score of the classification (0-1)',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'reasoning',
      type: BaseType.STRING,
      description: 'AI explanation for the classification',
    }),
  ]
}

/** Node definition for text classifier */
export const textClassifierDefinition: NodeDefinition<TextClassifierNodeData> = defineFromManifest(
  textClassifierManifest as unknown as NodeManifest<TextClassifierNodeData>,
  { outputVariables: getTextClassifierOutputVariables as any }
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
