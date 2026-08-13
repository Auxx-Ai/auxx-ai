// apps/web/src/components/workflow/nodes/core/resource-trigger/schema.ts

import { type NodeManifest, resourceTriggerManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import { getResourceTriggerOutputVariables } from './output-variables'
import type { ResourceTriggerData } from './types'

// The data half (data interface, zod schema, defaults, validator) lives in
// the node catalog (`@auxx/lib/workflow-engine/catalog/nodes/resource-trigger`).
// This file is the merge site: manifest + the web-only output resolver (which
// reads the resource store context and moves server-side in Phase 2).

/**
 * Unified resource trigger definition
 * Now supports both system resources and custom entities
 */
export const resourceTriggerDefinition: NodeDefinition<ResourceTriggerData> = defineFromManifest(
  resourceTriggerManifest as unknown as NodeManifest<ResourceTriggerData>,
  // Pattern: Accepts resource context from var store for dynamic variable generation
  { outputVariables: getResourceTriggerOutputVariables }
)

// Back-compat re-exports so no consumer import churns:
export {
  createResourceTriggerDefaultData,
  validateResourceTriggerConfig,
} from '@auxx/lib/workflow-engine/client'
