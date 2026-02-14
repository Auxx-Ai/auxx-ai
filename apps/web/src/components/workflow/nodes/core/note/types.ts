// apps/web/src/components/workflow/nodes/core/note/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

export type NoteTheme = 'yellow' | 'blue' | 'purple' | 'pink' | 'green'

/**
 * Note node data interface with flattened structure
 */
export interface NoteNodeData extends BaseNodeData {
  text: string
  theme: NoteTheme
  showAuthor: boolean
  author: string
  fontSize: number
}

/**
 * Full Note node type for React Flow
 */
export type NoteNode = SpecificNode<'note', NoteNodeData>
