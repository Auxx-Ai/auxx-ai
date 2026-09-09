// packages/lib/scripts/sweep-orphaned-resource-access.ts
//
// One-off data fix for `ResourceAccess` rows whose target no longer exists.
//
// `ResourceAccess.entityInstanceId` is a bare `text()` column with no foreign
// key, and it cannot have one: `entityDefinitionId` carries two disjoint
// keyspaces (an `EntityDefinition.id`, or a reserved slug such as 'thread' /
// 'dashboard' / 'kb'), so the row's target resolves against a different table
// per row. Nothing had ever cleaned these up, so deleting a record, a thread or
// a sequence left every share row on it behind forever. Every one of them grants
// a member access to nothing (plans/permissions/v2/46-member-shared-items.md
// §11, which found 3 by looking at records and threads alone).
//
// ⚠️ On dev, 88 of 678 instance-level rows are orphaned, and 87 of those are
// `sequence`. Plan 46 §11 counted only the record and thread keyspaces; the
// sequence keyspace is by some distance the largest producer, and it is NOT
// fixed at the source yet — `sequences/crud.ts::deleteSequence` deletes the
// hidden `WorkflowApp` (which cascades onto `Sequence`) in one unwrapped
// statement and sweeps nothing. Re-running this script will keep finding new
// sequence orphans until that door sweeps both its own id and the
// `workflowAppId` it destroys.
//
// Fixed at the source: `deleteEntityInstances` sweeps a record's rows inside its
// delete transaction (which covers records, contacts, inboxes and signatures,
// since it is the single write seam every record delete reaches), and the thread
// doors — `ThreadMutationService.deletePermanently` / `bulkDeletePermanently`,
// `channels/deleteChannelData`, and the ingest empty-thread cleanup — sweep
// theirs. This clears what accumulated before that.
//
// ⚠️ Only rows whose keyspace can be resolved with certainty are judged. Every
// slug below is mapped to the ONE table its `entityInstanceId` addresses; a def
// cuid addresses `EntityInstance`; and anything else — an unknown slug, or a
// def cuid whose definition is itself gone — is REPORTED and never deleted.
// A def whose row vanished is `deleteEntityDefinitionDeep`'s job, not this one.
//
// ⚠️ Type-level rows (`entityInstanceId IS NULL`) are not orphans at all: they
// describe the definition, which is still alive. They are excluded outright.
//
// Idempotent and re-runnable: a second run finds nothing and changes nothing.
//
//   npx dotenv -- node --conditions source --import tsx/esm \
//     packages/lib/scripts/sweep-orphaned-resource-access.ts [--apply]

import { database as db } from '@auxx/database'
import { sql } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')

/**
 * Reserved `entityDefinitionId` slugs and the table each one's
 * `entityInstanceId` addresses. Keep in sync with `INSTANCE_ACCESS_RESOURCES`
 * (`permissions/capabilities/instance-access.ts`) and the `entityDefinitionId`
 * docstring on the schema.
 *
 * `inbox`, `personal_inbox`, `signature` and every record type slug (`contact`,
 * `order`, …) are absent deliberately: those address `EntityInstance` like any
 * record (the standalone `Signature` table was retired), so they fall through to
 * the instance arm below, which matches an `EntityDefinition` by id OR by
 * `entityType`. That arm is second, so a slug listed here always wins.
 */
const SLUG_TABLES: Record<string, string> = {
  thread: 'Thread',
  message: 'Message',
  snippet: 'Snippet',
  sequence: 'Sequence',
  dataset: 'Dataset',
  kb: 'KnowledgeBase',
  dashboard: 'Dashboard',
  workflow: 'WorkflowApp',
  agent: 'Agent',
}

/**
 * `true` = target is gone, `false` = target is alive, `NULL` = not ours to
 * judge. The instance-backed arm requires the definition to still exist, so a
 * row pointing at a dead definition is never judged here.
 */
const orphanedExpression = sql.join(
  [
    sql`CASE`,
    ...Object.entries(SLUG_TABLES).map(
      ([slug, table]) => sql`
        WHEN ra."entityDefinitionId" = ${slug}
          THEN NOT EXISTS (
            SELECT 1 FROM ${sql.raw(`"${table}"`)} tgt WHERE tgt.id = ra."entityInstanceId"
          )`
    ),
    sql`
        WHEN EXISTS (
          SELECT 1 FROM "EntityDefinition" ed
          WHERE ed.id = ra."entityDefinitionId"
             OR (ed."organizationId" = ra."organizationId"
                 AND ed."entityType" = ra."entityDefinitionId")
        )
          THEN NOT EXISTS (
            SELECT 1 FROM "EntityInstance" ei WHERE ei.id = ra."entityInstanceId"
          )`,
    sql`ELSE NULL END`,
  ],
  sql` `
)

interface OrphanGroup extends Record<string, unknown> {
  organizationId: string
  entityDefinitionId: string
  count: number
}

async function orphansByKeyspace(): Promise<OrphanGroup[]> {
  const { rows } = await db.execute<OrphanGroup>(sql`
    SELECT ra."organizationId", ra."entityDefinitionId", count(*)::int AS count
    FROM "ResourceAccess" ra
    WHERE ra."entityInstanceId" IS NOT NULL
      AND (${orphanedExpression}) IS TRUE
    GROUP BY 1, 2
    ORDER BY 3 DESC
  `)
  return rows
}

/** Rows this script refuses to judge, so "we did not touch these" is a number. */
async function unjudgedByKeyspace(): Promise<Array<{ entityDefinitionId: string; count: number }>> {
  const { rows } = await db.execute<{ entityDefinitionId: string; count: number }>(sql`
    SELECT ra."entityDefinitionId", count(*)::int AS count
    FROM "ResourceAccess" ra
    WHERE ra."entityInstanceId" IS NOT NULL
      AND (${orphanedExpression}) IS NULL
    GROUP BY 1
    ORDER BY 2 DESC
  `)
  return rows
}

async function totals(): Promise<{ all: number; instanceLevel: number }> {
  const { rows } = await db.execute<{ all: number; instanceLevel: number }>(sql`
    SELECT count(*)::int AS "all",
           count(*) FILTER (WHERE "entityInstanceId" IS NOT NULL)::int AS "instanceLevel"
    FROM "ResourceAccess"
  `)
  return rows[0] ?? { all: 0, instanceLevel: 0 }
}

async function deleteOrphans(): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    DELETE FROM "ResourceAccess" ra
    WHERE ra."entityInstanceId" IS NOT NULL
      AND (${orphanedExpression}) IS TRUE
    RETURNING ra.id
  `)
  return rows.length
}

async function main() {
  console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN — nothing is written (pass --apply) ──\n')

  const counts = await totals()
  console.log(`ResourceAccess rows: ${counts.all} (${counts.instanceLevel} instance-level)\n`)

  const groups = await orphansByKeyspace()
  const orphanTotal = groups.reduce((sum, row) => sum + row.count, 0)

  console.log(`Orphaned instance rows (target no longer exists): ${orphanTotal}`)
  for (const group of groups) {
    console.log(
      `  ${group.entityDefinitionId.padEnd(28)} ${String(group.count).padStart(6)}  org=${group.organizationId}`
    )
  }

  const unjudged = await unjudgedByKeyspace()
  const unjudgedTotal = unjudged.reduce((sum, row) => sum + row.count, 0)
  if (unjudgedTotal > 0) {
    console.log(
      `\n  not judged (unknown keyspace, or the definition itself is gone): ${unjudgedTotal}`
    )
    for (const row of unjudged) {
      console.log(`    ${row.entityDefinitionId.padEnd(28)} ${row.count}`)
    }
  }

  if (APPLY) {
    const deleted = await deleteOrphans()
    console.log(`\n  deleted ${deleted}`)
  }

  console.log(APPLY ? '\nSweep complete.' : '\nDry run complete.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
