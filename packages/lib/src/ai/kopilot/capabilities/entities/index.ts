// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import {
  createBulkUpdateEntityTool,
  createCreateEntityTool,
  createCreateNoteTool,
  createGetEntityHistoryTool,
  createGetEntityTool,
  createGetTranscriptTool,
  createListEntitiesTool,
  createListEntityFieldsTool,
  createListFieldChangesTool,
  createListNotesTool,
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
      createListNotesTool(getDeps),
      createCreateNoteTool(getDeps),
      createListFieldChangesTool(getDeps),
      createListTranscriptsForEntityTool(getDeps),
      createGetTranscriptTool(getDeps),
      createUpdateEntityTool(getDeps),
      createBulkUpdateEntityTool(getDeps),
      createCreateEntityTool(getDeps),
    ],
    capabilities: [
      'Search & find records like contacts, companies, tickets, and orders',
      'Pull a record’s recent activity, threads, notes, tasks, and meetings in one shot',
      'Read and write internal notes (comments) on records',
      'Read meeting transcripts',
      'Create new records',
      'Update existing records',
    ],
  }
}
