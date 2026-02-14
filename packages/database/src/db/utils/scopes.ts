// packages/database/src/db/utils/scopes.ts
// Common scope helpers for Drizzle models

import { eq, type SQL } from 'drizzle-orm'

/**
 * orgScope: returns an organizationId equality filter if the table has the column and orgId provided.
 * Safe to call for any table; returns undefined if not applicable.
 */
export function orgScope(
  table: Record<string, any>,
  organizationId?: string
): SQL<unknown> | undefined {
  if (!organizationId) return undefined
  if (table && typeof table === 'object' && 'organizationId' in table) {
    return eq((table as any).organizationId, organizationId)
  }
  return undefined
}
