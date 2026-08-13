// apps/web/src/components/workflow/nodes/core/wait/types.ts

import type { CatalogWaitNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/wait`); re-exported here so no web
// import churns. WaitNodeData narrows `type` to the web NodeType enum, same
// as BaseNodeData does over its lib counterpart.
export { DurationUnit, WaitType } from '@auxx/lib/workflow-engine/client'

/**
 * Wait node data interface with complete structure
 */
export interface WaitNodeData extends CatalogWaitNodeData {
  type: NodeType
}

/**
 * Full Wait node type for React Flow
 */
export type WaitNode = SpecificNode<'wait', WaitNodeData>
