// apps/web/src/components/workflow/nodes/core/human/schema.ts

import { humanConfirmationManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { HumanConfirmationNodeData } from './types'

// The data half (schema, defaults, validator, three-way branch rules, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/human`). This file is the merge
// site: manifest + the React parts.

/**
 * Human confirmation node definition
 */
export const humanConfirmationDefinition: NodeDefinition<HumanConfirmationNodeData> =
  defineFromManifest(
    humanConfirmationManifest as unknown as NodeManifest<HumanConfirmationNodeData>,
    {}
  )

// Back-compat re-exports so no consumer import churns:
export {
  humanConfirmationNodeDataSchema,
  validateHumanConfirmationConfig,
} from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new human confirmation nodes
 */
export const humanConfirmationDefaultData =
  humanConfirmationManifest.defaultData() as Partial<HumanConfirmationNodeData>
