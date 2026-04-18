// packages/lib/src/seed/entity-migrations/migrations/009-participant-is-internal.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import {
  extractRegistrableDomain,
  getOwnDomains,
  normalizeDomain,
} from '../../../ingest/domain/classifier'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:009')

/**
 * Migration 009: Backfill `Participant.isInternal`.
 *
 * The column was added in Drizzle migration 0124 with default `false`. This migration
 * walks every email participant for the org, classifies it against the org's own
 * domains (via `getOwnDomains` + `extractRegistrableDomain`), and updates rows whose
 * stored value disagrees with the live classification. Idempotent — re-runs only
 * write rows that need flipping.
 */
export const migration009ParticipantIsInternal: EntityMigration = {
  id: '009-participant-is-internal',
  description: 'Backfill Participant.isInternal from organization own-domains',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const ownDomains = await getOwnDomains(organizationId)
    if (ownDomains.size === 0) {
      // Org has no domains configured — nothing can be internal. Default `false`
      // already matches; no writes needed.
      return { ...state, alreadyUpToDate: true }
    }

    const participants = await db
      .select({
        id: schema.Participant.id,
        identifier: schema.Participant.identifier,
        isInternal: schema.Participant.isInternal,
      })
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, organizationId),
          eq(schema.Participant.identifierType, 'EMAIL')
        )
      )

    const idsToFlipTrue: string[] = []
    const idsToFlipFalse: string[] = []

    for (const p of participants) {
      const domain = extractRegistrableDomain(p.identifier)
      const shouldBeInternal = domain ? ownDomains.has(normalizeDomain(domain)) : false

      if (shouldBeInternal && !p.isInternal) idsToFlipTrue.push(p.id)
      else if (!shouldBeInternal && p.isInternal) idsToFlipFalse.push(p.id)
    }

    const BATCH_SIZE = 500
    const now = new Date()
    let totalUpdated = 0

    for (let i = 0; i < idsToFlipTrue.length; i += BATCH_SIZE) {
      const batch = idsToFlipTrue.slice(i, i + BATCH_SIZE)
      await db
        .update(schema.Participant)
        .set({ isInternal: true, updatedAt: now })
        .where(inArray(schema.Participant.id, batch))
      totalUpdated += batch.length
    }

    for (let i = 0; i < idsToFlipFalse.length; i += BATCH_SIZE) {
      const batch = idsToFlipFalse.slice(i, i + BATCH_SIZE)
      await db
        .update(schema.Participant)
        .set({ isInternal: false, updatedAt: now })
        .where(inArray(schema.Participant.id, batch))
      totalUpdated += batch.length
    }

    const alreadyUpToDate = totalUpdated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 009 applied', {
        organizationId,
        flippedToTrue: idsToFlipTrue.length,
        flippedToFalse: idsToFlipFalse.length,
        totalParticipants: participants.length,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
