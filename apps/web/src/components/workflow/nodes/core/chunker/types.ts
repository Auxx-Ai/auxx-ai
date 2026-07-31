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

  /** Maximum chunk size in characters (default: 6000). A string when bound to a variable. */
  chunkSize?: number | string
  /** Overlap between chunks in characters (default: 500). A string when bound to a variable. */
  chunkOverlap?: number | string
  /** Custom delimiter for splitting (e.g., '\n\n') */
  delimiter?: string
  /** Replace consecutive spaces/newlines (default: true). A string when bound to a variable. */
  normalizeWhitespace?: boolean | string
  /** Remove URLs and email addresses (default: false). A string when bound to a variable. */
  removeUrlsAndEmails?: boolean | string

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Chunker node type for React Flow
 */
export type ChunkerNode = SpecificNode<'chunker', ChunkerNodeData>
