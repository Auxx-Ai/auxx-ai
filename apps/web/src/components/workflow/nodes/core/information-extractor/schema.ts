// apps/web/src/components/workflow/nodes/core/information-extractor/schema.ts

import { informationExtractorManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { InformationExtractorNodeData } from './types'

// The data half (config types, zod schemas, defaults, validator, variable
// extraction, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/information-extractor`). This file
// is just the merge site.

/** Node definition for information extractor */
export const informationExtractorDefinition: NodeDefinition<InformationExtractorNodeData> =
  defineFromManifest(
    informationExtractorManifest as unknown as NodeManifest<InformationExtractorNodeData>,
    {}
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
