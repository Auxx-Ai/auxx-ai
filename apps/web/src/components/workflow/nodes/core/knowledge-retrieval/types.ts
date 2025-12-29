// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Search type options for knowledge retrieval
 */
export type SearchType = 'vector' | 'text' | 'hybrid'

/**
 * Dataset selection entry
 */
export interface DatasetEntry {
  /** Dataset ID (from picker or variable) */
  datasetId: string
}

/**
 * Knowledge Retrieval node data interface
 */
export interface KnowledgeRetrievalNodeData extends BaseNodeData {
  /** Node title */
  title: string
  /** Short description */
  desc?: string
  /** Full description */
  description?: string

  // === Query Input ===
  /** Search query text (from variable or constant) */
  query?: string

  // === Dataset Selection ===
  /** Array of datasets to search across */
  datasets?: DatasetEntry[]

  // === Search Configuration ===
  /** Search strategy: 'vector', 'text', or 'hybrid' (default: 'hybrid') */
  searchType?: SearchType
  /** Maximum number of results to return (default: 20) */
  limit?: number
  /** Minimum similarity threshold for vector search (default: 0.7, range: 0-1) */
  similarityThreshold?: number

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Knowledge Retrieval node type for React Flow
 */
export type KnowledgeRetrievalNode = SpecificNode<'knowledge-retrieval', KnowledgeRetrievalNodeData>
