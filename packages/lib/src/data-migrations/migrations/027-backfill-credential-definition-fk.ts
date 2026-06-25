// packages/lib/src/data-migrations/migrations/027-backfill-credential-definition-fk.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-027')

/**
 * Backfill `Credential.connectionDefinitionId` for legacy rows that predate the FK, so it can be
 * flipped to NOT NULL in a later release (Phase 1.3 — never in the same release as this, since the
 * Drizzle DDL runs at deploy while this runs at boot). Idempotent: every step only touches rows
 * whose FK `IS NULL`, so a re-run after a partial pass repairs the remainder.
 *
 * Resolution by owner:
 *  - **mcp** rows → the lone def for `mcpServerId`.
 *  - **app** rows → the method def for `appId`. New rows already set it at connect; legacy rows
 *    didn't record which method, so single-method apps resolve to the lone def and multi-method
 *    apps fall back to a deterministic pick (newest major, base/lowest key) — logged for review.
 *  - **connection** rows (channels/AI keys/platform providers) → already set by `saveConnection`
 *    and migration 026; a defensive `type → providerKey` pass catches any straggler.
 *
 * A final pass logs how many rows still have a null FK, so the NOT NULL flip's readiness is visible.
 */
export const migration027BackfillCredentialDefinitionFk: DataMigrationDef = {
  id: '027-backfill-credential-definition-fk',
  description: 'Backfill Credential.connectionDefinitionId for legacy app/mcp/connection rows',
  async run(db: Database): Promise<void> {
    // 1. MCP rows — one definition per server.
    await db.execute(sql`
      UPDATE "Credential" c
         SET "connectionDefinitionId" = (
               SELECT cd.id
                 FROM "ConnectionDefinition" cd
                WHERE cd."mcpServerId" = c."mcpServerId"
                ORDER BY cd.major DESC
                LIMIT 1
             )
       WHERE c.kind = 'mcp'
         AND c."connectionDefinitionId" IS NULL
         AND c."mcpServerId" IS NOT NULL
         AND EXISTS (
               SELECT 1 FROM "ConnectionDefinition" cd WHERE cd."mcpServerId" = c."mcpServerId"
             )
    `)

    // 2. Connection rows — defensive: resolve by the denormalized providerKey (`type`). The bulk
    //    are already set; this only catches a straggler that slipped past saveConnection / 026.
    await db.execute(sql`
      UPDATE "Credential" c
         SET "connectionDefinitionId" = (
               SELECT cd.id
                 FROM "ConnectionDefinition" cd
                WHERE cd."providerKey" = c.type
                ORDER BY cd.major DESC
                LIMIT 1
             )
       WHERE c.kind = 'connection'
         AND c."connectionDefinitionId" IS NULL
         AND c.type IS NOT NULL
         AND EXISTS (
               SELECT 1 FROM "ConnectionDefinition" cd WHERE cd."providerKey" = c.type
             )
    `)

    // 3. App rows — the method isn't recorded on legacy credentials, so resolve per-row: lone def
    //    for single-method apps, deterministic pick (+ warning) for the rare multi-method case.
    const appRows = await db.query.Credential.findMany({
      columns: { id: true, appId: true, organizationId: true },
      where: and(
        eq(schema.Credential.kind, 'app'),
        isNull(schema.Credential.connectionDefinitionId)
      ),
    })

    for (const row of appRows) {
      if (!row.appId) {
        logger.warn('app credential has no appId — cannot resolve definition', {
          credentialId: row.id,
          organizationId: row.organizationId,
        })
        continue
      }
      const defs = await db.query.ConnectionDefinition.findMany({
        columns: { id: true, key: true, major: true },
        where: eq(schema.ConnectionDefinition.appId, row.appId),
      })
      if (defs.length === 0) {
        logger.warn('no connection definition found for app credential', {
          credentialId: row.id,
          appId: row.appId,
        })
        continue
      }

      // Deterministic: newest major, then the base method (null key first), then lowest key.
      const chosen = [...defs].sort((a, b) => {
        if (b.major !== a.major) return b.major - a.major
        if ((a.key === null) !== (b.key === null)) return a.key === null ? -1 : 1
        return (a.key ?? '').localeCompare(b.key ?? '')
      })[0]!

      if (defs.length > 1) {
        logger.warn('ambiguous app method for legacy credential — bound to deterministic pick', {
          credentialId: row.id,
          appId: row.appId,
          chosenDefinitionId: chosen.id,
          candidateCount: defs.length,
        })
      }

      await db
        .update(schema.Credential)
        .set({ connectionDefinitionId: chosen.id })
        .where(eq(schema.Credential.id, row.id))
    }

    // 4. Readiness signal for the NOT NULL flip (Phase 1.3).
    const remaining = await db.execute(sql`
      SELECT count(*)::int AS n FROM "Credential" WHERE "connectionDefinitionId" IS NULL
    `)
    const n = Number((remaining.rows[0] as { n: number | string } | undefined)?.n ?? 0)
    if (n > 0) {
      logger.warn('credentials still missing connectionDefinitionId after backfill', {
        remaining: n,
        note: 'NOT NULL flip (Phase 1.3) is unsafe until these are resolved or removed',
      })
    } else {
      logger.info('all credentials have a connectionDefinitionId — NOT NULL flip is ready')
    }
  },
}
