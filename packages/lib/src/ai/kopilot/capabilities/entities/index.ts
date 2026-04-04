// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import {
  createBulkUpdateEntityTool,
  createCreateEntityTool,
  createGetEntityTool,
  createListEntitiesTool,
  createListEntityFieldsTool,
  createQueryRecordsTool,
  createSearchEntitiesTool,
  createUpdateEntityTool,
} from './tools'

/**
 * Create the global entity capability set.
 * Provides 7 tools for discovering, searching, querying, reading, creating, and updating any entity type.
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
      createUpdateEntityTool(getDeps),
      createBulkUpdateEntityTool(getDeps),
      createCreateEntityTool(getDeps),
    ],
  }
}
