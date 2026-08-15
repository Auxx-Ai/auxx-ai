// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types'
import { createNestedVariable } from '~/components/workflow/utils/variable-conversion'
import type { KnowledgeRetrievalNodeData } from './types'

/**
 * Generate output variables for Knowledge Retrieval node
 * Matches SearchResponse from packages/lib/src/datasets/types/search.types.ts
 */
export function getKnowledgeRetrievalOutputVariables(
  _data: KnowledgeRetrievalNodeData,
  nodeId: string
): UnifiedVariable[] {
  return [
    // Results array with full search result structure
    createNestedVariable({
      nodeId,
      basePath: 'results',
      type: BaseType.ARRAY,
      label: 'Results',
      description: 'Array of search results from datasets',
      items: {
        type: BaseType.OBJECT,
        label: 'Search Result',
        description: 'A single search result',
        properties: {
          content: {
            type: BaseType.STRING,
            label: 'Content',
            description: 'Text content of the segment',
          },
          score: {
            type: BaseType.NUMBER,
            label: 'Score',
            description: 'Relevance score (higher is more relevant)',
          },
          rank: {
            type: BaseType.NUMBER,
            label: 'Rank',
            description: 'Position in search results (1-based)',
          },
          segmentId: {
            type: BaseType.STRING,
            label: 'Segment ID',
            description: 'ID of the document segment',
          },
          documentId: {
            type: BaseType.STRING,
            label: 'Document ID',
            description: 'ID of the parent document',
          },
          documentTitle: {
            type: BaseType.STRING,
            label: 'Document Title',
            description: 'Title of the parent document',
          },
          datasetId: {
            type: BaseType.STRING,
            label: 'Dataset ID',
            description: 'ID of the source dataset',
          },
          datasetName: {
            type: BaseType.STRING,
            label: 'Dataset Name',
            description: 'Name of the source dataset',
          },
          position: {
            type: BaseType.NUMBER,
            label: 'Position',
            description: 'Segment position within document',
          },
          searchType: {
            type: BaseType.STRING,
            label: 'Search Type',
            description: 'Type of search that found this result',
          },
          source: {
            type: BaseType.STRING,
            label: 'Source',
            description: "'kb' for a knowledge-base article, 'rag' for an uploaded document",
          },
          articleId: {
            type: BaseType.STRING,
            label: 'Article ID',
            description: 'ID of the KB article (KB results only)',
          },
          articleSlug: {
            type: BaseType.STRING,
            label: 'Article Slug',
            description: 'Slug of the KB article (KB results only)',
          },
          articleSlugPath: {
            type: BaseType.STRING,
            label: 'Article Slug Path',
            description: 'Full slug path of the KB article within its KB (KB results only)',
          },
          kbId: {
            type: BaseType.STRING,
            label: 'Knowledge Base ID',
            description: 'ID of the knowledge base (KB results only)',
          },
          kbSlug: {
            type: BaseType.STRING,
            label: 'Knowledge Base Slug',
            description: 'Slug of the knowledge base (KB results only)',
          },
          docSlug: {
            type: BaseType.STRING,
            label: 'Doc Slug',
            description:
              'kbSlug/articleSlugPath — cite as [Title](auxx://doc/<docSlug>) (KB results only)',
          },
        },
      },
    }),

    // Total count
    createNestedVariable({
      nodeId,
      basePath: 'total',
      type: BaseType.NUMBER,
      label: 'Total',
      description: 'Total number of results found',
    }),

    // Response time
    createNestedVariable({
      nodeId,
      basePath: 'responseTime',
      type: BaseType.NUMBER,
      label: 'Response Time',
      description: 'Search execution time in milliseconds',
    }),

    // Pagination flag
    createNestedVariable({
      nodeId,
      basePath: 'hasMore',
      type: BaseType.BOOLEAN,
      label: 'Has More',
      description: 'Whether more results are available beyond the limit',
    }),

    // Original query echo
    createNestedVariable({
      nodeId,
      basePath: 'query',
      type: BaseType.STRING,
      label: 'Query',
      description: 'The original search query',
    }),

    // Search type used
    createNestedVariable({
      nodeId,
      basePath: 'searchType',
      type: BaseType.STRING,
      label: 'Search Type',
      description: 'The search strategy used (vector/text/hybrid)',
    }),

    // Success flag
    createNestedVariable({
      nodeId,
      basePath: 'success',
      type: BaseType.BOOLEAN,
      label: 'Success',
      description: 'Whether the search completed successfully',
    }),

    // Error message
    createNestedVariable({
      nodeId,
      basePath: 'error',
      type: BaseType.STRING,
      label: 'Error',
      description: 'Error message if search failed (null if successful)',
    }),
  ]
}
