// apps/web/src/components/workflow/nodes/core/manual/types.ts

import type { CatalogManualNodeData } from '@auxx/lib/workflow-engine/client'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/manual`).

/**
 * Manual trigger node data interface
 */
export interface ManualNodeData extends CatalogManualNodeData {
  type: NodeType.MANUAL
}
