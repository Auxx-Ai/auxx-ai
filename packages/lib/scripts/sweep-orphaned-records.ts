// packages/lib/scripts/sweep-orphaned-records.ts
//
// One-off data fix for the two orphan classes that hard deletes have been leaving
// behind. Both are fixed at the source now — `deleteEntityInstance` sweeps a
// record's timeline, `deleteEntityDefinitionDeep` sweeps every instance's timeline
// before the cascade, and `field-hooks/pre/order-delete-guard.ts` cascades an
// order's lines the way the invoice guard always has. This clears what accumulated
// before that.
//
// PHASE 1 — line items attached to no document.
//   Deleting an order used to strip only the `line_item_order` mirror row (via
//   `sweepEntityFieldValues`) and leave the lines themselves. Same for quotes,
//   which `quote-delete-guard.ts` deferred explicitly ("quote line items dangle
//   like today"). The survivors belong to no quote, work order, invoice or order,
//   so no surface can reach them — every line surface is document-scoped — but
//   every `line_item` query still counts them.
//
//   Lines carrying a `line_item_visit_id` are EXCLUDED even when document-less:
//   that is a plain-text bridge into dispatch (visits are not entities), and a
//   live visit reference is not something this script gets to judge. Reported
//   separately; dev has zero.
//
//   Deleted through `deleteEntityInstance`, not raw SQL, so each one gets the
//   relation sweep and the timeline sweep it would get from a real delete.
//
// PHASE 2 — timeline events pointing at a record that no longer exists.
//   `TimelineEvent.entityId` has no FK and nothing ever cleaned it: 189,797 of
//   229,078 rows in dev (83%) were unreachable, including one 95,085-row block
//   from a single entity-definition teardown on 2026-06-24.
//
//   ⚠️ Not every timeline row is EntityInstance-backed. `entityType` is polymorphic
//   — `thread` rows resolve against `Thread`, `article` rows against `Article` —
//   so those are SKIPPED and merely reported. Everything else is instance-backed:
//   a CUID `entityType` comes from `createTimelineEvent` parsing a RecordId, which
//   only ever addresses an EntityInstance, and the name-keyed values come from
//   money's writers (`toRecordId('order', …)`), which address the same.
//
//   The orphan test is on `entityId` alone — never `entityType`, which carries two
//   keyspaces for one record (see `delete-entity-instance.ts`).
//
//   Rows where the dead record is only the RELATED end (`relatedEntityId`) are
//   left alone: that is a living record's own history. 28,948 such rows exist on
//   live records; they are a product question, not an orphan.
//
// Idempotent and re-runnable: a second run finds nothing and changes nothing.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/sweep-orphaned-records.ts [--dry-run]

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { deleteEntityInstance } from '../src/entity-instances/delete-entity-instance'

const DRY_RUN = process.argv.includes('--dry-run')

/**
 * `entityType` values whose `entityId` resolves against a table other than
 * `EntityInstance`. Rows carrying these are never judged orphaned here.
 */
const NON_INSTANCE_TYPES = ['thread', 'article', ''] as const

interface OrphanLine extends Record<string, unknown> {
  id: string
  organizationId: string
  displayName: string | null
}

/**
 * Line items holding none of the four document relations, and no visit bridge.
 */
async function findOrphanLines(): Promise<OrphanLine[]> {
  const { rows } = await db.execute<OrphanLine>(sql`
    SELECT ei.id, ei."organizationId", ei."displayName"
    FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
    WHERE ed."entityType" = 'line_item'
      AND NOT EXISTS (
        SELECT 1 FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ei.id
          AND fv."relatedEntityId" IS NOT NULL
          AND cf."systemAttribute" IN (
            'line_item_quote', 'line_item_invoice', 'line_item_work_order', 'line_item_order'
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ei.id
          AND cf."systemAttribute" = 'line_item_visit_id'
          AND coalesce(fv."valueText", '') <> ''
      )
    ORDER BY ei."organizationId", ei.id
  `)
  return rows
}

/** Document-less lines held back by the visit bridge — reported, never deleted. */
async function countVisitHeldLines(): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM "EntityInstance" ei
    JOIN "EntityDefinition" ed ON ed.id = ei."entityDefinitionId"
    WHERE ed."entityType" = 'line_item'
      AND NOT EXISTS (
        SELECT 1 FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ei.id
          AND fv."relatedEntityId" IS NOT NULL
          AND cf."systemAttribute" IN (
            'line_item_quote', 'line_item_invoice', 'line_item_work_order', 'line_item_order'
          )
      )
      AND EXISTS (
        SELECT 1 FROM "FieldValue" fv
        JOIN "CustomField" cf ON cf.id = fv."fieldId"
        WHERE fv."entityId" = ei.id
          AND cf."systemAttribute" = 'line_item_visit_id'
          AND coalesce(fv."valueText", '') <> ''
      )
  `)
  return rows[0]?.count ?? 0
}

/** Instance-backed timeline rows whose record is gone, by entityType. */
async function timelineOrphansByType(): Promise<Array<{ entityType: string; count: number }>> {
  const { rows } = await db.execute<{ entityType: string; count: number }>(sql`
    SELECT te."entityType", count(*)::int AS count
    FROM "TimelineEvent" te
    WHERE te."entityType" NOT IN (${sql.join(
      NON_INSTANCE_TYPES.map((t) => sql`${t}`),
      sql`, `
    )})
      AND NOT EXISTS (SELECT 1 FROM "EntityInstance" ei WHERE ei.id = te."entityId")
    GROUP BY 1
    ORDER BY 2 DESC
  `)
  return rows
}

/** Skipped rows, so "we did not touch these" is a number and not a claim. */
async function nonInstanceOrphanCount(): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM "TimelineEvent" te
    WHERE te."entityType" IN (${sql.join(
      NON_INSTANCE_TYPES.map((t) => sql`${t}`),
      sql`, `
    )})
      AND NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t.id = te."entityId")
      AND NOT EXISTS (SELECT 1 FROM "Article" a WHERE a.id = te."entityId")
  `)
  return rows[0]?.count ?? 0
}

async function deleteTimelineOrphans(): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    DELETE FROM "TimelineEvent" te
    WHERE te."entityType" NOT IN (${sql.join(
      NON_INSTANCE_TYPES.map((t) => sql`${t}`),
      sql`, `
    )})
      AND NOT EXISTS (SELECT 1 FROM "EntityInstance" ei WHERE ei.id = te."entityId")
    RETURNING te.id
  `)
  return rows.length
}

async function main() {
  console.log(DRY_RUN ? '── DRY RUN — nothing is written ──\n' : '── APPLYING ──\n')

  // Phase 1 first: deleting a line sweeps its own timeline, so phase 2 does not
  // have to find those rows a second time.
  const orphanLines = await findOrphanLines()
  const visitHeld = await countVisitHeldLines()

  console.log(`Phase 1 — line items attached to no document: ${orphanLines.length}`)
  for (const line of orphanLines) {
    console.log(`  ${line.id}  org=${line.organizationId}  ${line.displayName ?? '(no name)'}`)
  }
  if (visitHeld > 0) {
    console.log(`  (${visitHeld} more are document-less but carry a visit bridge — left alone)`)
  }

  let linesDeleted = 0
  if (!DRY_RUN) {
    for (const line of orphanLines) {
      const result = await deleteEntityInstance({
        id: line.id,
        organizationId: line.organizationId,
      })
      if (result.isErr()) {
        console.error(`  FAILED ${line.id}: ${result.error.message}`)
        continue
      }
      linesDeleted++
    }
    console.log(`  deleted ${linesDeleted}`)
  }

  const byType = await timelineOrphansByType()
  const timelineTotal = byType.reduce((sum, row) => sum + row.count, 0)
  const skipped = await nonInstanceOrphanCount()

  console.log(`\nPhase 2 — timeline events whose record is gone: ${timelineTotal}`)
  for (const row of byType.slice(0, 15)) {
    console.log(`  ${row.entityType.padEnd(26)} ${row.count}`)
  }
  if (byType.length > 15) {
    console.log(`  … and ${byType.length - 15} more entityType values`)
  }
  console.log(`  skipped (thread/article-backed, orphaned but not ours to judge): ${skipped}`)

  if (!DRY_RUN) {
    const deleted = await deleteTimelineOrphans()
    console.log(`  deleted ${deleted}`)
  }

  console.log(DRY_RUN ? '\nDry run complete.' : '\nSweep complete.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
