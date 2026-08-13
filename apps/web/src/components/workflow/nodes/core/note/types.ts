// apps/web/src/components/workflow/nodes/core/note/types.ts

import type { CatalogNoteNodeData } from '@auxx/lib/workflow-engine/client'
import type { SpecificNode } from '~/components/workflow/types/node-base'
import type { NodeType } from '~/components/workflow/types/node-types'

// The data half moved to the node catalog (node-catalog Phase 1 —
// `@auxx/lib/workflow-engine/catalog/nodes/note`).
export type { NoteTheme } from '@auxx/lib/workflow-engine/client'

/**
 * Note node data interface with flattened structure
 */
export interface NoteNodeData extends CatalogNoteNodeData {
  type: NodeType
}

/**
 * Full Note node type for React Flow
 */
export type NoteNode = SpecificNode<'note', NoteNodeData>
