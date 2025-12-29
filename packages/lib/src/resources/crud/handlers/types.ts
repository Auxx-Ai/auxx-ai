// packages/lib/src/resources/crud/handlers/types.ts

import type { CrudContext, CrudResult, TransformedData, BulkResult } from '../types'

/** Handler interface - each resource type implements this */
export interface ResourceHandler {
  /** Resource type(s) this handler supports */
  supports: (resourceType: string) => boolean

  /** Create a record */
  create: (data: TransformedData, ctx: CrudContext) => Promise<CrudResult>

  /** Update a record */
  update: (id: string, data: TransformedData, ctx: CrudContext) => Promise<CrudResult>

  /** Delete a record */
  delete: (id: string, ctx: CrudContext) => Promise<CrudResult>

  /** Find record by unique field (for duplicate detection) */
  findByField?: (fieldKey: string, value: string, ctx: CrudContext) => Promise<string | null>

  /** Optional optimized bulk create */
  bulkCreate?: (records: TransformedData[], ctx: CrudContext) => Promise<BulkResult>
}
