// apps/web/src/components/workflow/nodes/core/dataset/types.ts

import type { DocumentTypeValues } from '@auxx/database/enums'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Dataset node data interface
 */
export interface DatasetNodeData extends BaseNodeData {
  /** Node title */
  title: string
  /** Short description */
  desc?: string
  /** Full description */
  description?: string

  // === Dataset Selection ===
  /** Target dataset ID (from picker or variable) */
  datasetId?: string

  // === Chunks Input ===
  /** Chunked content from Chunker node (DocumentChunk[]) */
  chunks?: string

  // === Document Settings ===
  /** Document title for identification */
  documentTitle?: string
  /** Content mime type (default: 'text/plain') */
  mimeType?: string
  /** Document type (PDF, DOCX, TXT, etc.) */
  documentType?: (typeof DocumentTypeValues)[number]
  /** Source URL for the content */
  sourceUrl?: string
  /** Reference to source MediaAsset ID */
  fileId?: string

  // === Processing Options ===
  /** Skip embedding generation (default: false) */
  skipEmbedding?: boolean
  /** Additional metadata to store with the document */
  metadata?: Record<string, unknown>

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Dataset node type for React Flow
 */
export type DatasetNode = SpecificNode<'dataset', DatasetNodeData>
