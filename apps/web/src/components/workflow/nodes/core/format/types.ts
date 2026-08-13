// apps/web/src/components/workflow/nodes/core/format/types.ts

import type { CatalogFormatNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/format`); the operation vocabulary
// and per-operation config types were already lib-side in
// `@auxx/lib/workflow-engine/constants`.
export type { FormatOperation } from '@auxx/lib/workflow-engine/constants'

/** Main node data */
export interface FormatNodeData extends CatalogFormatNodeData {
  type: NodeType
}

export type FormatNode = SpecificNode<'format', FormatNodeData>
