// packages/lib/src/ai/kopilot/capabilities/entities/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import {
  createCreateEntityTool,
  createGetEntityTool,
  createListEntitiesTool,
  createListEntityFieldsTool,
  createSearchEntitiesTool,
  createUpdateEntityTool,
} from './tools'

/**
 * Create the global entity capability set.
 * Provides 6 tools for discovering, searching, reading, creating, and updating any entity type.
 * Registered as __global__ — available on all pages.
 */
export function createEntityCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [
      createListEntitiesTool(getDeps),
      createListEntityFieldsTool(getDeps),
      createSearchEntitiesTool(getDeps),
      createGetEntityTool(getDeps),
      createUpdateEntityTool(getDeps),
      createCreateEntityTool(getDeps),
    ],
  }
}
