// packages/lib/src/resources/merge/merge-duplicate-resolution.int.test.ts
//
// DB-backed test (vitest.integration.config.ts → auxx_test) that the merge
// service actually RESOLVES its duplicate suggestions (plan §3.4).
//
// `resolveSuggestionsForMerge`'s own behaviour — which rows are stamped `merged`
// and which are deleted — is pinned in `dedup/__tests__/dedup-engine.int.test.ts`.
// What is under test HERE is the wiring: that `EntityMergeService.merge` calls
// it, inside the same transaction as the archive, so a merge cannot leave the
// review queue offering a pair the user just resolved.
//
// It runs the real service against real SQL rather than a fake tx because the
// claim is "the pair is gone from the queue AFTER a merge", and a fake
// transaction can only show that a function was called.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { toRecordId } from '../resource-id'
import { EntityMergeService } from './merge-service'

const db = () => getTestDb() as never as import('@auxx/database').Database

async function seed() {
  const org = await createTestOrganization()
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const instance = async (name: string) => {
    const [row] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: org.id,
        entityDefinitionId: def?.id as string,
        displayName: name,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  return {
    orgId: org.id,
    userId: org.ownerId,
    defId: def?.id as string,
    target: await instance('Target'),
    source: await instance('Source'),
    bystander: await instance('Bystander'),
  }
}

async function insertPair(orgId: string, defId: string, x: string, y: string): Promise<void> {
  const [low, high] = [x, y].sort() as [string, string]
  await db().insert(schema.DuplicateSuggestion).values({
    organizationId: orgId,
    entityDefinitionId: defId,
    instanceIdLow: low,
    instanceIdHigh: high,
    score: 0.9,
    band: 'high',
    signals: [],
    status: 'open',
  })
}

async function storedPairs(orgId: string) {
  return db()
    .select({
      id: schema.DuplicateSuggestion.id,
      status: schema.DuplicateSuggestion.status,
      low: schema.DuplicateSuggestion.instanceIdLow,
      high: schema.DuplicateSuggestion.instanceIdHigh,
    })
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, orgId))
}

describe('EntityMergeService.merge — duplicate suggestion resolution', () => {
  it('stamps the acted-on pair `merged` and closes the source’s other pairs', async () => {
    const f = await seed()
    await insertPair(f.orgId, f.defId, f.target, f.source)
    await insertPair(f.orgId, f.defId, f.source, f.bystander)

    const service = new EntityMergeService(db(), f.orgId, f.userId)
    await service.merge({
      targetRecordId: toRecordId(f.defId, f.target),
      sourceRecordIds: [toRecordId(f.defId, f.source)],
    })

    const rows = await storedPairs(f.orgId)

    // The acted-on pair survives as `merged` — terminal, and the audit trail
    // that this suggestion led somewhere. The bystander pair is DELETED: it was
    // never acted on, and whether the bystander still duplicates the TARGET is
    // a fact for the target's next scan to establish, not one to migrate.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('merged')
    expect([rows[0]?.low, rows[0]?.high].sort()).toEqual([f.target, f.source].sort())
  })

  it('leaves pairs that touch neither side alone', async () => {
    const f = await seed()
    await insertPair(f.orgId, f.defId, f.target, f.source)
    // A pair between two records the merge does not involve.
    const [other] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: f.orgId,
        entityDefinitionId: f.defId,
        displayName: 'Other',
        updatedAt: new Date(),
      })
      .returning()
    await insertPair(f.orgId, f.defId, f.bystander, other?.id as string)

    const service = new EntityMergeService(db(), f.orgId, f.userId)
    await service.merge({
      targetRecordId: toRecordId(f.defId, f.target),
      sourceRecordIds: [toRecordId(f.defId, f.source)],
    })

    const rows = await storedPairs(f.orgId)
    expect(rows).toHaveLength(2)
    expect(rows.filter((row) => row.status === 'open')).toHaveLength(1)
  })
})
