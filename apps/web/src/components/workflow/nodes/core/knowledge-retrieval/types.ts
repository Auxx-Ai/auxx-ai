// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/types.ts

import type { BaseNodeData, SpecificNode } from '~/components/workflow/types/node-base'

/**
 * Search type options for knowledge retrieval
 */
export type SearchType = 'vector' | 'text' | 'hybrid'

/**
 * One selected knowledge source.
 *
 * The row's `kind` is STORED, not inferred from which id field is populated —
 * a row whose id is variable-bound still has to know which picker it renders
 * and which resolver arm it belongs to.
 */
export type KnowledgeSourceRow =
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'kb'; knowledgeBaseId: string }

/** The `fieldModes` key for a row's id field — kind-dependent. */
export function sourceFieldKey(row: KnowledgeSourceRow, index: number): string {
  return row.kind === 'kb' ? `sources.${index}.knowledgeBaseId` : `sources.${index}.datasetId`
}

/** The raw (possibly variable-reference) id a row carries. */
export function sourceRawId(row: KnowledgeSourceRow): string {
  return row.kind === 'kb' ? row.knowledgeBaseId : row.datasetId
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

  // === Knowledge Selection ===
  /** Knowledge bases and/or RAG datasets to search across */
  sources?: KnowledgeSourceRow[]

  // === Search Configuration ===
  /**
   * Search strategy: 'vector', 'text', or 'hybrid' (default: 'hybrid').
   * A variable reference string when bound to a variable.
   */
  searchType?: SearchType | string
  /** Maximum number of results to return (default: 20, max 25). A string when bound. */
  limit?: number | string
  /**
   * Minimum similarity threshold for vector search (range: 0-1).
   * **No default** — unset lets the vector lane's own 0.4 floor apply, which is
   * what the `search_knowledge` agent path gets over identical content.
   * A string when bound to a variable.
   */
  similarityThreshold?: number | string
  /**
   * Return one best passage per article/document instead of raw segments.
   * Schema default false (existing nodes keep their behaviour); `defaultData`
   * sets it true so new nodes get the good behaviour.
   */
  dedupePerDocument?: boolean | string
  /**
   * Keep only segments whose `metadata.links[]` include one of these record
   * ids — "search knowledge relevant to *this* contact/order".
   */
  recordIds?: string[] | string

  /** Track constant/variable mode per field */
  fieldModes?: Record<string, boolean>
}

/**
 * Specific Knowledge Retrieval node type for React Flow
 */
export type KnowledgeRetrievalNode = SpecificNode<'knowledge-retrieval', KnowledgeRetrievalNodeData>
