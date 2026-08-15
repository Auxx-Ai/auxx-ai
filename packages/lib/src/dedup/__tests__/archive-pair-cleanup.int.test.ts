// packages/lib/src/dedup/__tests__/archive-pair-cleanup.int.test.ts
//
// DB-backed test (vitest.integration.config.ts → auxx_test) for the archive
// cleanup: WHICH rows the delete takes.
//
// Integration and not unit because the whole claim is a predicate claim —
// "`open` goes, `dismissed` and `merged` stay, and only for THIS record". A fake
// db records the call and proves none of it.
//
// The rule this pins: **deletion is how an `open` pair goes away; `dismissed`
// and `merged` are the only persisted terminal states.** `dismissed` carries the
// `dismissedBand` that governs reopen-on-upgrade — delete it and a genuine
// future re-match at the same band nags from scratch. `merged` is the audit
// trail of a real merge.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { deleteOpenPairsForRecord } from '../pairs'

const db = () => getTestDb() as never as import('@auxx/database').Database

interface Fixture {
  orgId: string
  defId: string
  a: string
  b: string
  c: string
}

async function seed(): Promise<Fixture> {
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

  // Canonical order is `instanceIdLow < instanceIdHigh` by string comparison, so
  // the ids are sorted here rather than assumed from insert order.
  const ids = [await instance('A'), await instance('B'), await instance('C')].sort()
  return {
    orgId: org.id,
    defId: def?.id as string,
    a: ids[0] as string,
    b: ids[1] as string,
    c: ids[2] as string,
  }
}

async function pair(
  f: Fixture,
  low: string,
  high: string,
  status: 'open' | 'dismissed' | 'merged',
  extra: Record<string, unknown> = {}
): Promise<string> {
  const [row] = await db()
    .insert(schema.DuplicateSuggestion)
    .values({
      organizationId: f.orgId,
      entityDefinitionId: f.defId,
      instanceIdLow: low,
      instanceIdHigh: high,
      score: 0.9,
      band: 'high',
      signals: [{ type: 'email', strength: 'strong', value: 'x@y.com' }],
      status,
      ...extra,
    })
    .returning()
  return row?.id as string
}

async function surviving(f: Fixture) {
  const rows = await db()
    .select({
      id: schema.DuplicateSuggestion.id,
      status: schema.DuplicateSuggestion.status,
      dismissedBand: schema.DuplicateSuggestion.dismissedBand,
    })
    .from(schema.DuplicateSuggestion)
    .where(eq(schema.DuplicateSuggestion.organizationId, f.orgId))
  return rows
}

describe('deleteOpenPairsForRecord — the archive-path cleanup', () => {
  it('deletes the record’s open pairs from BOTH sides of the canonical order', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, 'open') // archived record is LOW
    await pair(f, f.b, f.c, 'open') // archived record is HIGH

    const result = await deleteOpenPairsForRecord(db(), f.orgId, f.b)

    expect(result._unsafeUnwrap()).toBe(2)
    expect(await surviving(f)).toHaveLength(0)
  })

  it('leaves `dismissed` alone — it carries the band that governs reopen', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, 'open')
    await pair(f, f.b, f.c, 'dismissed', { dismissedBand: 'medium', dismissedAt: new Date() })

    const result = await deleteOpenPairsForRecord(db(), f.orgId, f.b)

    expect(result._unsafeUnwrap()).toBe(1)
    const rows = await surviving(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('dismissed')
    expect(rows[0]?.dismissedBand).toBe('medium')
  })

  it('leaves `merged` alone — merge is terminal', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, 'merged')

    const result = await deleteOpenPairsForRecord(db(), f.orgId, f.b)

    expect(result._unsafeUnwrap()).toBe(0)
    expect((await surviving(f))[0]?.status).toBe('merged')
  })

  it('never touches a pair the record is not part of', async () => {
    const f = await seed()
    await pair(f, f.a, f.c, 'open')

    const result = await deleteOpenPairsForRecord(db(), f.orgId, f.b)

    expect(result._unsafeUnwrap()).toBe(0)
    expect(await surviving(f)).toHaveLength(1)
  })

  it('is org-scoped', async () => {
    const f = await seed()
    const other = await seed()
    await pair(other, other.a, other.b, 'open')

    const result = await deleteOpenPairsForRecord(db(), f.orgId, other.a)

    expect(result._unsafeUnwrap()).toBe(0)
    expect(await surviving(other)).toHaveLength(1)
  })

  it('is a no-op for a record with no pairs', async () => {
    const f = await seed()
    expect((await deleteOpenPairsForRecord(db(), f.orgId, f.a))._unsafeUnwrap()).toBe(0)
  })
})
