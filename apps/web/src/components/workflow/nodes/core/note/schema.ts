// apps/web/src/components/workflow/nodes/core/note/schema.ts

import { type NodeManifest, noteManifest } from '@auxx/lib/workflow-engine/client'
import type { NodeDefinition } from '../../../types'
import { defineFromManifest } from '../../define-from-manifest'
import type { NoteNodeData } from './types'

// The data half (schema, defaults, validator) lives in the node catalog
// (`@auxx/lib/workflow-engine/catalog/nodes/note`). This file is the merge
// site.

/**
 * Node definition for Note
 */
export const noteDefinition: NodeDefinition<NoteNodeData> = defineFromManifest(
  noteManifest as unknown as NodeManifest<NoteNodeData>,
  {}
)

// Back-compat re-exports so no consumer import churns:
export { noteNodeDataSchema, validateNoteConfig } from '@auxx/lib/workflow-engine/client'

/**
 * Default configuration for new note nodes
 */
export const noteDefaultData = noteManifest.defaultData() as Partial<NoteNodeData>
