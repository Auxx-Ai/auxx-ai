// apps/web/src/components/workflow/nodes/core/note/schema.ts

import { z } from 'zod'
import { baseNodeDataSchema } from '~/components/workflow/types/node-base'
import { NodeCategory, type NodeDefinition, type ValidationResult } from '../../../types'
import { NodeType } from '../../../types/node-types'
import { DEFAULT_NOTE_HEIGHT, DEFAULT_NOTE_WIDTH } from './constants'
import { NotePanel } from './panel'
import type { NoteNodeData, NoteTheme } from './types'

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
 * Default configuration for new note nodes
 */
export const noteDefaultData: Partial<NoteNodeData> = {
  title: 'Note',
  desc: '',
  text: '',
  theme: 'yellow' as NoteTheme,
  showAuthor: false,
  author: '',
  fontSize: 14,
}

/**
 * Validation function for note configuration
 */
export const validateNoteConfig = (data: NoteNodeData): ValidationResult => {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  // Note nodes don't require validation as they're just for documentation
  // All fields are optional and have defaults

  return { isValid: true, errors }
}

/**
 * Node definition for Note
 */
export const noteDefinition: NodeDefinition<NoteNodeData> = {
  id: NodeType.NOTE,
  category: NodeCategory.DATA,
  displayName: 'Note',
  description: 'Add notes and documentation to your workflow',
  icon: 'sticky-note',
  color: '#FBBF24',
  defaultData: noteDefaultData,
  schema: noteNodeDataSchema,
  panel: NotePanel,
  validator: validateNoteConfig,
  canConnect: false, // Note nodes can be added to canvas but cannot connect to other blocks
  // Custom properties for note nodes
  defaultWidth: DEFAULT_NOTE_WIDTH,
  defaultHeight: DEFAULT_NOTE_HEIGHT,
  extractVariables: () => [], // Note nodes don't extract variables
}
