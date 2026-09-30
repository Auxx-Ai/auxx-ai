// packages/lib/src/inventory/costing/service-kind-blockers.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { findSystemRecordIdsByValue, systemFields } from '../../resources/system-records'

const MOVEMENT_REASON = 'it has stock movements'
const BUILD_REASON = 'it has builds'

/** BOM relations that make a part a stocked thing, in the order their reason wins. */
const BLOCKERS = [
  ['subpart_parent_part', 'it has a bill of materials'],
  ['subpart_child_part', "it is a component in another part's bill of materials"],
] as const

/**
 * Why each of `partIds` cannot become a `service` (107 F3), keyed by part instance id.
 * Archived movements and BOM lines count, and every build. Parts with no blocker are absent.
 */
export async function readServiceKindBlockers(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Map<string, string>> {
  const blockers = new Map<string, string>()
  const unique = [...new Set(partIds.filter(Boolean))]
  if (unique.length === 0) return blockers

  const t = schema.StockMovement
  const moved = await db
    .selectDistinct({ partId: t.partId })
    .from(t)
    .where(and(eq(t.organizationId, organizationId), inArray(t.partId, unique)))
  for (const row of moved) blockers.set(row.partId, MOVEMENT_REASON)

  const b = schema.Build
  const built = await db
    .selectDistinct({ partId: b.partId })
    .from(b)
    .where(and(eq(b.organizationId, organizationId), inArray(b.partId, unique)))
  for (const row of built) if (!blockers.has(row.partId)) blockers.set(row.partId, BUILD_REASON)

  const subpart = await systemFields(db, organizationId, 'subpart', [
    'subpart_parent_part',
    'subpart_child_part',
  ] as const)
  // Archived BOM lines count, so each lookup includes them.
  const archived = { includeArchived: true }
  const none = new Map<string, string[]>()
  const found = await Promise.all([
    subpart
      ? findSystemRecordIdsByValue(
          db,
          organizationId,
          subpart,
          { attribute: 'subpart_parent_part', related: unique },
          archived
        )
      : none,
    subpart
      ? findSystemRecordIdsByValue(
          db,
          organizationId,
          subpart,
          { attribute: 'subpart_child_part', related: unique },
          archived
        )
      : none,
  ])
  // `found` is in BLOCKERS order, so the first reason set wins.
  for (const [index, [, reason]] of BLOCKERS.entries()) {
    for (const partId of found[index]!.keys()) {
      if (!blockers.has(partId)) blockers.set(partId, reason)
    }
  }
  return blockers
}

/** The refusal sentence for one part, from a {@link readServiceKindBlockers} reason. */
export function serviceKindRefusal(reason: string): string {
  return `This part cannot become a service because ${reason}. A service is never stocked.`
}
