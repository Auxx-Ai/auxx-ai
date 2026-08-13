// packages/lib/src/workflow-engine/catalog/nodes/note.ts

import { z } from 'zod'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'

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
 * Zod schema for note node data (flattened structure)
 */
export const noteNodeDataSchema = baseNodeDataSchema.extend({
  text: z.string().default(''),
  theme: z.enum(['yellow', 'blue', 'purple', 'pink', 'green'] as const).default('yellow'),
  showAuthor: z.boolean().default(false),
  author: z.string().default(''),
  fontSize: z.number().min(10).max(20).default(14),
})

/**
 * Validation function for note configuration
 */
export const validateNoteConfig = (_data: NoteNodeData): NodeValidationResult => {
  // Note nodes don't require validation as they're just for documentation
  // All fields are optional and have defaults
  return { isValid: true, errors: [] }
}

/**
 * Note node manifest
 */
export const noteManifest: NodeManifest<NoteNodeData> = {
  id: 'note',
  category: NodeCategory.DATA,
  displayName: 'Note',
  description: 'Add notes and documentation to your workflow',
  icon: 'sticky-note',
  color: '#FBBF24',
  defaultData: () => ({
    title: 'Note',
    desc: '',
    text: '',
    theme: 'yellow' as NoteTheme,
    showAuthor: false,
    author: '',
    fontSize: 14,
  }),
  configSchema: noteNodeDataSchema as unknown as z.ZodType<NoteNodeData>,
  validate: validateNoteConfig,
  extractVariables: () => [], // Note nodes don't extract variables
  connection: {
    canConnect: false, // Notes can be added to canvas but cannot connect to other blocks
  },
  agent: {
    authorable: true,
    usage: 'Canvas annotation only — no connections, no outputs. `text` is the note body.',
    examples: [
      {
        description: 'Document a section of the graph',
        config: { text: 'Escalation path: only fires for VIP customers.' },
      },
    ],
  },
}
