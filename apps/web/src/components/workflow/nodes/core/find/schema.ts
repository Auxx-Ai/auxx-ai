// apps/web/src/components/workflow/nodes/core/find/schema.ts

import { findManifest, type NodeManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { FindNodeData } from './types'

// The data half (data interface, zod schema, defaults, validator, variable
// extractor, output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/find`). This file is the merge
// site: manifest + the React parts.

/**
 * Find node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity).
 */
export const findDefinition: NodeDefinition<FindNodeData> = defineFromManifest(
  findManifest as unknown as NodeManifest<FindNodeData>,
  {}
)

// Back-compat re-exports so no panel or consumer import churns:
export {
  extractFindVariables,
  findNodeDataSchema,
  validateFindNodeConfig,
} from '@auxx/lib/workflow-engine/client'
