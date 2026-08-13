// apps/web/src/components/workflow/nodes/core/resource-trigger/schema.ts

import { type NodeManifest, resourceTriggerManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { ResourceTriggerData } from './types'

// The data half (data interface, zod schema, defaults, validator, output
// resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/resource-trigger`). This file is
// the merge site: manifest + the React parts.

/**
 * Unified resource trigger definition
 * Now supports both system resources and custom entities
 */
export const resourceTriggerDefinition: NodeDefinition<ResourceTriggerData> = defineFromManifest(
  resourceTriggerManifest as unknown as NodeManifest<ResourceTriggerData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export {
  createResourceTriggerDefaultData,
  validateResourceTriggerConfig,
} from '@auxx/lib/workflow-engine/client'
