// packages/lib/src/inventory/builds/build-row.ts

import type { BuildEntity } from '@auxx/database'
import type { BuildRecord } from './types'

/** One `Build` row as Drizzle selects it. */
export type BuildRow = BuildEntity

/** The read shape of a row: every column except `organizationId`, with `id` as `buildId`. */
export function toBuildRecord(row: BuildRow): BuildRecord {
  const { id, organizationId: _organizationId, ...columns } = row
  return { buildId: id, ...columns }
}
