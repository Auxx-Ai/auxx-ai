// packages/lib/src/data-migrations/migrations/202-reset-builds.ts
// Deletes every build of the EAV `build` entity, the movements and postings it produced, and the
// entity itself. Nothing is carried over. See plans/mrp/23-build-table.md §5 (B1).

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { onCacheEvent } from '../../cache'
import { deleteEntityDefinitionDeep } from '../../entity-definitions/delete-entity-definition'
import { ConflictError } from '../../errors'
import { batchRecalculateQoH } from '../../inventory/costing/qoh'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:202')

/** String literals, not the registry: the build registry entries are deleted with this release. */
export const BUILD_MIRROR_ATTRIBUTES = ['part_builds', 'order_builds'] as const

const QOH_CHUNK = 500

export interface Migration202Result extends PerOrgMigrationResult {
  buildsDeleted: number
  movementsDeleted: number
  postingsDeleted: number
  partsRecomputed: number
}

const NOTHING: Migration202Result = {
  entityDefsCreated: 0,
  fieldsCreated: 0,
  relationshipsLinked: 0,
  alreadyUpToDate: true,
  buildsDeleted: 0,
  movementsDeleted: 0,
  postingsDeleted: 0,
  partsRecomputed: 0,
}

interface ResetCounts {
  builds: number
  movements: number
  postings: number
  partIds: string[]
  sidebarNodes: number
}

async function count(tx: Transaction, query: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute<{ n: string }>(query)
  return Number(result.rows[0]?.n ?? 0)
}

/** Collect, refuse on an exported posting, then delete, for one org inside `tx`. */
async function resetOrg(
  tx: Transaction,
  organizationId: string,
  buildDefId: string
): Promise<ResetCounts> {
  // The def delete FK-checks every instance; on DemoOrg1 that outran the pool's 30s timeout (201).
  await tx.execute(sql`SET LOCAL statement_timeout = 0`)

  // Every EAV build, plus any build id a movement still names that is not a `Build` row: an EAV
  // build hard-deleted between the deploy and this run leaves its legs behind.
  await tx.execute(sql`
    CREATE TEMP TABLE _m202_build ON COMMIT DROP AS
    SELECT id FROM "EntityInstance"
    WHERE "organizationId" = ${organizationId} AND "entityDefinitionId" = ${buildDefId}
    UNION
    SELECT sm."buildId" FROM "StockMovement" sm
    WHERE sm."organizationId" = ${organizationId}
      AND sm."buildId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Build" b WHERE b.id = sm."buildId")
  `)
  await tx.execute(sql`ALTER TABLE _m202_build ADD PRIMARY KEY (id)`)

  // A build's legs, plus any BOM child or reversal hanging off one, so the self FKs never dangle.
  await tx.execute(sql`
    CREATE TEMP TABLE _m202_move ON COMMIT DROP AS
    WITH RECURSIVE m(id) AS (
      SELECT sm.id FROM "StockMovement" sm
      WHERE sm."organizationId" = ${organizationId}
        AND sm."buildId" IN (SELECT id FROM _m202_build)
      UNION
      SELECT c.id FROM "StockMovement" c
      JOIN m ON c."parentMovementId" = m.id OR c."reversesMovementId" = m.id
    )
    SELECT m.id, sm."partId" FROM m JOIN "StockMovement" sm ON sm.id = m.id
  `)
  await tx.execute(sql`ALTER TABLE _m202_move ADD PRIMARY KEY (id)`)
  // Build and movement ids in one set, so each posting lookup is a single hashed semi-join.
  await tx.execute(sql`
    CREATE TEMP TABLE _m202_source ON COMMIT DROP AS
    SELECT id FROM _m202_build UNION SELECT id FROM _m202_move
  `)
  await tx.execute(sql`ANALYZE _m202_build`)
  await tx.execute(sql`ANALYZE _m202_move`)
  await tx.execute(sql`ANALYZE _m202_source`)

  // Posting lines carry the build id (or a movement id) as their source, beside the source links;
  // a reversal joins its original's set so the restrict FK on `reversesId` never blocks.
  await tx.execute(sql`
    CREATE TEMP TABLE _m202_posting ON COMMIT DROP AS
    WITH RECURSIVE p(id) AS (
      SELECT s."glPostingId" FROM "GlPostingSource" s
      WHERE s."organizationId" = ${organizationId}
        AND s."sourceKind" IN ('build', 'stock_movement')
        AND s."sourceId" IN (SELECT id FROM _m202_source)
      UNION
      SELECT l."glPostingId" FROM "GlPostingLine" l
      WHERE l."organizationId" = ${organizationId}
        AND l."sourceType" IN ('build', 'stock_movement')
        AND l."sourceId" IN (SELECT id FROM _m202_source)
      UNION
      SELECT g.id FROM "GlPosting" g JOIN p ON g."reversesId" = p.id
    )
    SELECT DISTINCT id FROM p
  `)
  await tx.execute(sql`ALTER TABLE _m202_posting ADD PRIMARY KEY (id)`)

  await tx.execute(sql`
    CREATE TEMP TABLE _m202_batch ON COMMIT DROP AS
    SELECT DISTINCT e."batchId" AS id FROM "ExportBatchPosting" e
    WHERE e."organizationId" = ${organizationId}
      AND e."glPostingId" IN (SELECT id FROM _m202_posting)
  `)
  // Held until commit, so a send cannot move one of these batches to `sending` after the check.
  await tx.execute(sql`
    SELECT id FROM "ExportBatch"
    WHERE "organizationId" = ${organizationId} AND id IN (SELECT id FROM _m202_batch)
    ORDER BY id FOR UPDATE
  `)

  // Exported: a live batch membership whose batch is on (or may be on) the provider.
  const exported = await count(
    tx,
    sql`
      SELECT count(DISTINCT e."glPostingId") AS n
      FROM "ExportBatchPosting" e
      JOIN "ExportBatch" b ON b.id = e."batchId"
      WHERE e."organizationId" = ${organizationId}
        AND e."withdrawnAt" IS NULL
        AND e."glPostingId" IN (SELECT id FROM _m202_posting)
        AND (b.state IN ('sending', 'sent') OR b."providerObjectId" IS NOT NULL)
    `
  )
  if (exported > 0) {
    throw new ConflictError(
      `Organization ${organizationId} has ${exported} build posting(s) exported to its accounting ` +
        'provider. Roll them back in the Outbox, then re-run this migration.'
    )
  }

  const builds = await count(tx, sql`SELECT count(*) AS n FROM _m202_build`)
  const movements = await count(tx, sql`SELECT count(*) AS n FROM _m202_move`)
  const postings = await count(tx, sql`SELECT count(*) AS n FROM _m202_posting`)
  const partRows = await tx.execute<{ partId: string }>(
    sql`SELECT DISTINCT "partId" FROM _m202_move`
  )

  // Unsent batches holding one of these postings go whole: their frozen payload names it, and
  // any other member is rebuilt by the next export build. Withdrawn history loses only our rows.
  await tx.execute(sql`
    DELETE FROM "ExportBatch"
    WHERE "organizationId" = ${organizationId}
      AND id IN (SELECT id FROM _m202_batch) AND state IN ('ready', 'failed')
  `)
  await tx.execute(sql`
    DELETE FROM "ExportBatchPosting"
    WHERE "organizationId" = ${organizationId}
      AND "glPostingId" IN (SELECT id FROM _m202_posting)
  `)
  await tx.execute(sql`
    DELETE FROM "ExportBatch" b
    WHERE b."organizationId" = ${organizationId}
      AND b.id IN (SELECT id FROM _m202_batch)
      AND NOT EXISTS (SELECT 1 FROM "ExportBatchPosting" e WHERE e."batchId" = b.id)
  `)

  await tx.execute(sql`
    DELETE FROM "AccountingWorkItem"
    WHERE "organizationId" = ${organizationId}
      AND "sourceKind" IN ('build', 'stock_movement')
      AND "sourceId" IN (SELECT id FROM _m202_source)
  `)

  // `reversesId` is ON DELETE RESTRICT, checked per row: peel reversals off before originals.
  // Lines and source links cascade with their posting.
  for (;;) {
    const deleted = await tx.execute(sql`
      DELETE FROM "GlPosting" g
      WHERE g."organizationId" = ${organizationId}
        AND g.id IN (SELECT id FROM _m202_posting)
        AND NOT EXISTS (SELECT 1 FROM "GlPosting" r WHERE r."reversesId" = g.id)
    `)
    if ((deleted.rowCount ?? 0) === 0) break
  }

  await tx.execute(sql`
    DELETE FROM "StockMovement"
    WHERE "organizationId" = ${organizationId} AND id IN (SELECT id FROM _m202_move)
  `)

  // The mirror fields by attribute: a system field's stored inverse id is not reliably a
  // `CustomField.id`, so the deep delete's partner lookup cannot be trusted to find them (201).
  const mirrors = await tx
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        inArray(schema.CustomField.systemAttribute, [...BUILD_MIRROR_ATTRIBUTES])
      )
    )
  const mirrorIds = mirrors.map((row) => row.id)
  if (mirrorIds.length > 0) {
    await tx.delete(schema.FieldValue).where(inArray(schema.FieldValue.fieldId, mirrorIds))
    await tx.delete(schema.CustomField).where(inArray(schema.CustomField.id, mirrorIds))
  }
  // Any other value on a surviving record that points at a build (a custom relationship field).
  await tx.execute(sql`
    DELETE FROM "FieldValue"
    WHERE "organizationId" = ${organizationId} AND "relatedEntityDefinitionId" = ${buildDefId}
  `)
  await tx.execute(sql`
    DELETE FROM "FieldValue"
    WHERE "organizationId" = ${organizationId}
      AND "relatedEntityId" IN (SELECT id FROM _m202_build)
  `)
  // Own values before the def, so the def's cascade is instances and fields only.
  await tx
    .delete(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityDefinitionId, buildDefId)
      )
    )

  // The def FK on Dashboard is `set null`, which would leave a stray "Builds" org dashboard.
  await tx
    .delete(schema.Dashboard)
    .where(
      and(
        eq(schema.Dashboard.organizationId, organizationId),
        eq(schema.Dashboard.entityDefinitionId, buildDefId)
      )
    )
  const sidebar = await tx.execute(sql`
    DELETE FROM "SidebarNode"
    WHERE "organizationId" = ${organizationId}
      AND "targetType" = 'ENTITY_DEFINITION'
      AND "targetIds"->>'entityDefinitionId' = ${buildDefId}
  `)

  await deleteEntityDefinitionDeep({
    id: buildDefId,
    organizationId,
    db: tx as unknown as Database,
    allowSystemEntity: true,
  })

  return {
    builds,
    movements,
    postings,
    partIds: partRows.rows.map((row) => row.partId),
    sidebarNodes: sidebar.rowCount ?? 0,
  }
}

async function recalculateQoH(organizationId: string, partIds: string[]): Promise<void> {
  for (let offset = 0; offset < partIds.length; offset += QOH_CHUNK) {
    await batchRecalculateQoH(organizationId, partIds.slice(offset, offset + QOH_CHUNK))
  }
}

async function allOrgPartIds(db: Database, organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'part')
      )
    )
  return rows.map((row) => row.id)
}

/**
 * Migration 202: delete every build in the org with the `StockMovement` rows, postings, export
 * memberships and work items it produced, then the `build` def, its fields and the mirror fields
 * on part and order, in one transaction; then re-derive QoH for the parts those movements touched.
 * Refuses (throws) an org with an exported build posting. Idempotent: an org without the def only
 * re-derives QoH.
 */
export const migration202ResetBuilds: PerOrgMigration = {
  id: '202-reset-builds',
  description:
    'Deletes every build, its stock movements, postings and work items, and the build entity, ' +
    'ahead of the Build table (plans/mrp/23 §5). Refuses an org with an exported build posting.',

  async up(db: Database, organizationId: string): Promise<Migration202Result> {
    const [def] = await db
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, 'build')
        )
      )
      .limit(1)
    if (!def) {
      // A run that committed and then failed below retries here, with the touched parts unknown.
      const partIds = await allOrgPartIds(db, organizationId)
      await recalculateQoH(organizationId, partIds)
      return { ...NOTHING, partsRecomputed: partIds.length }
    }

    const reset = await db.transaction((tx) => resetOrg(tx, organizationId, def.id))

    // After the commit: the recompute reads through the pool.
    await recalculateQoH(organizationId, reset.partIds)
    await onCacheEvent('entity-def.deleted', { orgId: organizationId })
    await onCacheEvent('stock-setup.changed', { orgId: organizationId })
    if (reset.sidebarNodes > 0) {
      await onCacheEvent('sidebar.changed', { orgId: organizationId, broadcastUserKeys: true })
    }

    logger.info('Migration 202 applied', {
      organizationId,
      buildsDeleted: reset.builds,
      movementsDeleted: reset.movements,
      postingsDeleted: reset.postings,
      partsRecomputed: reset.partIds.length,
    })
    return {
      ...NOTHING,
      alreadyUpToDate: false,
      buildsDeleted: reset.builds,
      movementsDeleted: reset.movements,
      postingsDeleted: reset.postings,
      partsRecomputed: reset.partIds.length,
    }
  },
}
