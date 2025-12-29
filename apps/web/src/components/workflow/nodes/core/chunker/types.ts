// apps/web/src/components/workflow/nodes/core/chunker/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Chunker node data interface
 */
export interface ChunkerNodeData extends BaseNodeData {
  /** Node title */
  title: string
  /** Short description */
  desc?: string
  /** Full description */
  description?: string

  /** The text content to chunk - typically from Document Extractor output */
  content?: string

  /** Maximum chunk size in characters (default: 6000) */
  chunkSize?: number
  /** Overlap between chunks in characters (default: 500) */
  chunkOverlap?: number
  /** Custom delimiter for splitting (e.g., '\n\n') */
  delimiter?: string
  /** Replace consecutive spaces/newlines (default: true) */
  normalizeWhitespace?: boolean
  /** Remove URLs and email addresses (default: false) */
  removeUrlsAndEmails?: boolean

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Chunker node type for React Flow
 */
export type ChunkerNode = SpecificNode<'chunker', ChunkerNodeData>
