// apps/web/src/components/workflow/nodes/core/human/types.ts

import type { CatalogHumanConfirmationNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/human` — note the type id is
// 'human-confirmation' while this folder is `core/human`).

/**
 * Configuration data for the Human Confirmation node
 */
export interface HumanConfirmationNodeData extends CatalogHumanConfirmationNodeData {
  type: NodeType
}

/**
 * Complete type for the Human Confirmation node
 */
export type HumanConfirmationNode = SpecificNode<'human', HumanConfirmationNodeData>
