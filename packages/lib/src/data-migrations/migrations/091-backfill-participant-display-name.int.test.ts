// packages/lib/src/data-migrations/migrations/091-backfill-participant-display-name.int.test.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { and, eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { calculateDisplayName } from '../../ingest/participants/display'
import { migration091BackfillParticipantDisplayName as migration } from './091-backfill-participant-display-name'

/**
 * The backfill against a real Postgres — the only place the SQL `CASE` can be
 * checked against the TypeScript function it claims to mirror.
 *
 * Every expectation below is written as `calculateDisplayName(...)`, not as a
 * literal. A literal would let the two drift while the test stayed green; this way
 * the assertion IS the "matches the write path" claim.
 */
describe('migration 089 — Participant.displayName backfill', () => {
  let db: Database
  let organizationId: string

  beforeEach(async () => {
    db = getTestDb() as unknown as Database
    organizationId = (await createTestOrganization()).id
  })

  const insert = async (
    key: string,
    row: { name?: string | null; displayName?: string | null; identifier?: string }
  ): Promise<string> => {
    const [inserted] = await db
      .insert(schema.Participant)
      .values({
        organizationId,
        identifier: row.identifier ?? `${key}@example.com`,
        identifierType: 'EMAIL',
        name: row.name ?? null,
        displayName: row.displayName ?? null,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Participant.id })
    return inserted!.id
  }

  const displayNameOf = async (id: string): Promise<string | null> => {
    const [row] = await db
      .select({ displayName: schema.Participant.displayName })
      .from(schema.Participant)
      .where(eq(schema.Participant.id, id))
    return row?.displayName ?? null
  }

  it('fills a NULL from `name` — NOT from the identifier', async () => {
    // 316 of the 403 NULL rows on the dev DB are this shape. A flat
    // `SET displayName = identifier` would write the address here.
    const id = await insert('daniel', {
      name: 'Daniel Jackson',
      identifier: 'daniel.jackson18@outlook.com',
    })

    await migration.run(db)

    expect(await displayNameOf(id)).toBe(
      calculateDisplayName('Daniel Jackson', 'daniel.jackson18@outlook.com')
    )
    expect(await displayNameOf(id)).toBe('Daniel Jackson')
  })

  it('falls back to the identifier when there is no usable name', async () => {
    const blank = await insert('blank', { name: null, identifier: 'john.smith@gmail.com' })
    const whitespace = await insert('ws', { name: '   ', identifier: 'jane.doe@gmail.com' })

    await migration.run(db)

    expect(await displayNameOf(blank)).toBe(calculateDisplayName(null, 'john.smith@gmail.com'))
    expect(await displayNameOf(whitespace)).toBe(calculateDisplayName('   ', 'jane.doe@gmail.com'))
  })

  it('trims the name it writes, exactly as calculateDisplayName does', async () => {
    const id = await insert('padded', { name: '  Megan White  ' })

    await migration.run(db)

    expect(await displayNameOf(id)).toBe(calculateDisplayName('  Megan White  ', 'x@example.com'))
    expect(await displayNameOf(id)).toBe('Megan White')
  })

  /**
   * The truncation arm is reachable: one `CHAT_VISITOR` row on the dev DB has a
   * 36-character opaque identifier and no name. Replicated so a row backfilled here
   * is byte-identical to what ingest writes for the same inputs.
   */
  it('reproduces the >20-char non-email/non-phone truncation', async () => {
    const opaque = 'visitor_01hqzk9m4n7p2r5t8v1x3y6b9d'
    const id = await insert('opaque', { name: null, identifier: opaque })

    await migration.run(db)

    expect(await displayNameOf(id)).toBe(calculateDisplayName(null, opaque))
    expect(await displayNameOf(id)).toBe('visitor_01hqzk9...')
  })

  it('leaves a phone identifier untruncated', async () => {
    const id = await insert('phone', { name: null, identifier: '+4930901820' })

    await migration.run(db)

    expect(await displayNameOf(id)).toBe(calculateDisplayName(null, '+4930901820'))
    expect(await displayNameOf(id)).toBe('+4930901820')
  })

  it('never touches a row that already has a displayName', async () => {
    // Including the case where the stored value DISAGREES with what the write path
    // would produce today — this is a null backfill, not a re-derivation, and
    // rewriting a name a human may have corrected is out of its remit.
    const id = await insert('stale', { name: 'Robert Miller', displayName: 'Bob' })

    await migration.run(db)

    expect(await displayNameOf(id)).toBe('Bob')
  })

  it('is idempotent — a second pass writes nothing', async () => {
    const fromName = await insert('a', { name: 'Sarah Miller' })
    const fromIdentifier = await insert('b', { name: null, identifier: 'sarah@corp.com' })

    await migration.run(db)
    const first = [await displayNameOf(fromName), await displayNameOf(fromIdentifier)]
    await migration.run(db)

    expect([await displayNameOf(fromName), await displayNameOf(fromIdentifier)]).toEqual(first)
  })

  /**
   * 🔴 The reason this is a backfill and not a `SET NOT NULL`. Both blank means
   * `calculateDisplayName` returns `undefined`, so the row stays NULL — and must,
   * because ingest can produce it and ingest must never throw.
   */
  it('leaves a both-blank row NULL rather than writing an empty string', async () => {
    const id = await insert('empty', { name: '   ', identifier: '   ' })

    await migration.run(db)

    expect(calculateDisplayName('   ', '   ')).toBeUndefined()
    expect(await displayNameOf(id)).toBeNull()
  })

  it('walks past the batch boundary', async () => {
    // BATCH_SIZE is 500 and the loop is keyset-paginated on `id`; a cursor bug
    // would leave the tail of the key space untouched.
    const values = Array.from({ length: 620 }, (_, index) => ({
      organizationId,
      identifier: `bulk-${String(index).padStart(4, '0')}@example.com`,
      identifierType: 'EMAIL' as const,
      name: `Person ${index}`,
      displayName: null,
      updatedAt: new Date(),
    }))
    await db.insert(schema.Participant).values(values)

    await migration.run(db)

    const stillNull = await db
      .select({ id: schema.Participant.id })
      .from(schema.Participant)
      .where(
        and(
          eq(schema.Participant.organizationId, organizationId),
          isNull(schema.Participant.displayName)
        )
      )
    expect(stillNull).toHaveLength(0)

    const [last] = await db
      .select({ displayName: schema.Participant.displayName })
      .from(schema.Participant)
      .where(eq(schema.Participant.identifier, 'bulk-0619@example.com'))
    expect(last?.displayName).toBe('Person 619')
  })
})
