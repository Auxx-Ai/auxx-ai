// apps/web/src/components/workflow/nodes/core/wait/schema.ts

import { type NodeManifest, waitManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '~/components/workflow/types'
import { defineFromManifest } from '../../define-from-manifest'
import type { WaitNodeData } from './types'

// The data half (enums, data interface, zod schema, defaults, validator,
// output resolver) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/wait`). This file is the merge
// site: manifest + the React parts.

/**
 * Wait node definition.
 *
 * The cast bridges lib's `type: string` to the web `NodeType` narrowing —
 * safe because the manifest's defaults never set `type` (the node factory
 * assigns identity).
 */
export const waitDefinition: NodeDefinition<WaitNodeData> = defineFromManifest(
  waitManifest as unknown as NodeManifest<WaitNodeData>,
  {}
)

// Back-compat re-exports so no panel or consumer import churns:
export { validateWaitConfig, waitNodeDataSchema } from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new wait nodes
 */
export const waitDefaultData = waitManifest.defaultData() as Partial<WaitNodeData>
