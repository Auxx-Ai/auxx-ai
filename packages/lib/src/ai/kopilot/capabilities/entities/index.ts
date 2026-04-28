// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import {
  createBulkUpdateEntityTool,
  createCreateEntityTool,
  createGetEntityHistoryTool,
  createGetEntityTool,
  createGetTranscriptTool,
  createListCommentsTool,
  createListEntitiesTool,
  createListEntityFieldsTool,
  createListFieldChangesTool,
  createListTranscriptsForEntityTool,
  createQueryRecordsTool,
  createSearchEntitiesTool,
  createUpdateEntityTool,
} from './tools'

/**
 * Create the global entity capability set.
 * Discover/read/write tools for entities, plus rich-context retrieval (history,
 * comments, field changes, transcripts) used by both chat and the headless runner.
 * Registered as __global__ — available on all pages.
 */
export function createEntityCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [
      createListEntitiesTool(getDeps),
      createListEntityFieldsTool(getDeps),
      createSearchEntitiesTool(getDeps),
      createQueryRecordsTool(getDeps),
      createGetEntityTool(getDeps),
      createGetEntityHistoryTool(getDeps),
      createListCommentsTool(getDeps),
      createListFieldChangesTool(getDeps),
      createListTranscriptsForEntityTool(getDeps),
      createGetTranscriptTool(getDeps),
      createUpdateEntityTool(getDeps),
      createBulkUpdateEntityTool(getDeps),
      createCreateEntityTool(getDeps),
    ],
    capabilities: [
      'Search & find records like contacts, companies, tickets, and orders',
      'Pull a record’s recent activity, threads, comments, tasks, and meetings in one shot',
      'Read meeting transcripts',
      'Create new records',
      'Update existing records',
    ],
  }
}
