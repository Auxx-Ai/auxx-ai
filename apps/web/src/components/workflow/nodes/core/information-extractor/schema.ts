// apps/web/src/components/workflow/nodes/core/information-extractor/schema.ts

import { informationExtractorManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types/variable-types'
import { schemaToUnifiedVariable } from '~/components/workflow/utils/schema-to-variable'
import { createUnifiedOutputVariable } from '~/components/workflow/utils/variable-conversion'
import { defineFromManifest } from '../../define-from-manifest'
import type { InformationExtractorNodeData } from './types'

// The data half (config types, zod schemas, defaults, validator, variable
// extraction) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/information-extractor`). This file
// is the merge site: manifest + the web-only output resolver.

/**
 * Define output variables for information extractor node
 * Follows the same pattern as the AI node's getAiOutputVariables
 */
const getInformationExtractorOutputVariables = (
  data: InformationExtractorNodeData,
  nodeId: string
): UnifiedVariable[] => {
  const outputs: UnifiedVariable[] = []

  // Always include raw extraction result
  outputs.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'raw_extraction',
      type: BaseType.STRING,
      description: 'Raw extraction result as text',
    })
  )

  // Add extracted_data if structured output is enabled and schema is defined
  if (data.structured_output.enabled && data.structured_output.schema) {
    const extractedData = schemaToUnifiedVariable(
      data.structured_output.schema,
      nodeId,
      'extracted_data'
    )
    extractedData.label = 'Extracted Data'
    extractedData.description = 'Structured data extracted from the input'

    outputs.push(extractedData)
  }

  return outputs
}

/** Node definition for information extractor */
export const informationExtractorDefinition: NodeDefinition<InformationExtractorNodeData> =
  defineFromManifest(
    informationExtractorManifest as unknown as NodeManifest<InformationExtractorNodeData>,
    { outputVariables: getInformationExtractorOutputVariables }
  )

// Back-compat re-exports so no consumer import churns:
export {
  completionParamsSchema,
  informationExtractorSchema,
  validateInformationExtractor,
} from '@auxx/lib/workflow-engine/client'

/** Factory function to create default data */
export const createInformationExtractorDefaultData = (): Partial<InformationExtractorNodeData> =>
  informationExtractorManifest.defaultData() as Partial<InformationExtractorNodeData>
