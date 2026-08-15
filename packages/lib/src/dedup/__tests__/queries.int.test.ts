// packages/lib/src/dedup/__tests__/queries.int.test.ts
//
// DB-backed test (vitest.integration.config.ts → auxx_test) for the read paths
// behind the duplicate router (plan §3.1 / §3.1a / §3.6).
//
// Integration and not unit, for one reason that applies to every case below:
// **every claim here is a PREDICATE claim.** A fake db records the call and
// proves nothing about which rows come back — and the two rules these reads
// exist to enforce (a pair whose other side is invisible is absent; a pair
// whose either side is archived is absent, on ALL THREE read paths) are exactly
// the kind that a predicate-blind test passes vacuously.
//
// The scope predicates are built by hand here rather than resolved through the
// permissions module. What is under test is that `queries.ts` APPLIES a
// caller-supplied predicate to the RIGHT side of the pair, through the join
// aliases the correlation targets name — not how the router derives it.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { dismissPair } from '../pairs'
import {
  countOpenDuplicatePairs,
  DUPLICATE_HIGH_INSTANCE_ID_SQL,
  DUPLICATE_LOW_INSTANCE_ID_SQL,
  type DuplicateDefScope,
  type DuplicateSide,
  getVisibleDuplicatePair,
  listDuplicatePairs,
  listDuplicatePairsForRecord,
  orderByEstablishment,
} from '../queries'

const db = () => getTestDb() as never as import('@auxx/database').Database

interface Fixture {
  orgId: string
  /** A real `User.id` — `dismissedByUserId` carries a FK. */
  userId: string
  defId: string
  /** Sorted ascending, so `(a,b)`, `(b,c)`, `(a,c)` are all canonical. */
  a: string
  b: string
  c: string
  d: string
  /** Two more, so the paging test can build three DISJOINT pairs (one row each). */
  e: string
  g: string
  scopes: DuplicateDefScope[]
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
        secondaryDisplayValue: `${name.toLowerCase()}@acme.test`,
        updatedAt: new Date(),
      })
      .returning()
    return row?.id as string
  }

  const ids = [
    await instance('Alpha'),
    await instance('Bravo'),
    await instance('Charlie'),
    await instance('Delta'),
    await instance('Echo'),
    await instance('Golf'),
  ].sort()

  return {
    orgId: org.id,
    userId: org.ownerId,
    defId: def?.id as string,
    a: ids[0] as string,
    b: ids[1] as string,
    c: ids[2] as string,
    d: ids[3] as string,
    e: ids[4] as string,
    g: ids[5] as string,
    scopes: [{ entityDefinitionId: def?.id as string }],
  }
}

async function pair(
  f: Fixture,
  low: string,
  high: string,
  overrides: Record<string, unknown> = {}
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
      signals: [{ type: 'email', strength: 'strong', value: 'a@acme.test' }],
      status: 'open',
      ...overrides,
    })
    .returning()
  return row?.id as string
}

async function archive(instanceId: string) {
  await db()
    .update(schema.EntityInstance)
    .set({ archivedAt: new Date() })
    .where(eq(schema.EntityInstance.id, instanceId))
}

/** A scope that admits only the named instances — one arm per side. */
function onlyVisible(f: Fixture, visible: string[]): DuplicateDefScope[] {
  const list = sql.join(
    visible.map((id) => sql`${id}`),
    sql`, `
  )
  return [
    {
      entityDefinitionId: f.defId,
      lowWhere: sql`${DUPLICATE_LOW_INSTANCE_ID_SQL} IN (${list})`,
      highWhere: sql`${DUPLICATE_HIGH_INSTANCE_ID_SQL} IN (${list})`,
    },
  ]
}

describe('record scope — a pair whose OTHER side is invisible is absent', () => {
  it('drops the pair outright rather than rendering half of it', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)

    // The viewer can see A but not B. The pair carries B's display NAME, so a
    // post-fetch filter would already have read it into the process — this is
    // the visibility leak the predicate exists to close.
    const visible = await listDuplicatePairs(db(), {
      organizationId: f.orgId,
      scopes: onlyVisible(f, [f.a]),
    })

    expect(visible._unsafeUnwrap().items).toHaveLength(0)
  })

  it('keeps the pair when BOTH sides pass the scope', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)

    const result = await listDuplicatePairs(db(), {
      organizationId: f.orgId,
      scopes: onlyVisible(f, [f.a, f.b]),
    })

    expect(result._unsafeUnwrap().items).toHaveLength(1)
  })

  it('applies the same rule on forRecord and count', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    const scopes = onlyVisible(f, [f.a])

    const forRecord = await listDuplicatePairsForRecord(db(), {
      organizationId: f.orgId,
      instanceId: f.a,
      scopes,
    })
    const count = await countOpenDuplicatePairs(db(), { organizationId: f.orgId, scopes })

    expect(forRecord._unsafeUnwrap()).toHaveLength(0)
    expect(count._unsafeUnwrap()).toBe(0)
  })

  it('issues no query at all when nothing is reachable', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)

    // Arm 4, generalized: an empty scope list is "no reachable rows", which must
    // short-circuit rather than degrade into an unscoped read.
    expect(
      (await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: [] }))._unsafeUnwrap()
        .items
    ).toHaveLength(0)
    expect(
      (await countOpenDuplicatePairs(db(), { organizationId: f.orgId, scopes: [] }))._unsafeUnwrap()
    ).toBe(0)
  })

  it('excludes a definition that is absent from the scope list', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)

    const result = await listDuplicatePairs(db(), {
      organizationId: f.orgId,
      scopes: [{ entityDefinitionId: 'some-other-def' }],
    })

    expect(result._unsafeUnwrap().items).toHaveLength(0)
  })
})

describe('archived filtering — on ALL THREE read paths (§3.1a rule 1)', () => {
  it('hides a pair whose LOW side is archived', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    await archive(f.a)

    const result = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    expect(result._unsafeUnwrap().items).toHaveLength(0)
  })

  it('hides a pair whose HIGH side is archived', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    await archive(f.b)

    const result = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    expect(result._unsafeUnwrap().items).toHaveLength(0)
  })

  it('count agrees with list — the badge must not drift', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    await pair(f, f.c, f.d)
    await archive(f.c)

    const list = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    const count = await countOpenDuplicatePairs(db(), {
      organizationId: f.orgId,
      scopes: f.scopes,
    })

    // The whole point of putting the archived filter on `count` too: the badge
    // would otherwise advertise a pair the list refuses to render.
    expect(list._unsafeUnwrap().items).toHaveLength(1)
    expect(count._unsafeUnwrap()).toBe(1)
  })

  it('hides an archived-side pair from forRecord', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    await archive(f.b)

    const result = await listDuplicatePairsForRecord(db(), {
      organizationId: f.orgId,
      instanceId: f.a,
      scopes: f.scopes,
    })
    expect(result._unsafeUnwrap()).toHaveLength(0)
  })
})

describe('snooze window — snoozed is `open` plus a future snoozeUntil', () => {
  const HOUR = 60 * 60 * 1000

  it('hides a pair snoozed into the future', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, { snoozeUntil: new Date(Date.now() + HOUR) })

    const list = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    const count = await countOpenDuplicatePairs(db(), {
      organizationId: f.orgId,
      scopes: f.scopes,
    })

    expect(list._unsafeUnwrap().items).toHaveLength(0)
    expect(count._unsafeUnwrap()).toBe(0)
  })

  it('returns it again once the snooze has lapsed — no sweep required', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, { snoozeUntil: new Date(Date.now() - HOUR) })

    const list = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    expect(list._unsafeUnwrap().items).toHaveLength(1)
  })

  it('hides `dismissed` and `merged` from the queue', async () => {
    const f = await seed()
    await pair(f, f.a, f.b, { status: 'dismissed', dismissedBand: 'high' })
    await pair(f, f.c, f.d, { status: 'merged' })

    const list = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    expect(list._unsafeUnwrap().items).toHaveLength(0)
  })
})

describe('clustering + paging', () => {
  it('collapses A–B and B–C into ONE row for the component', async () => {
    // Three stored pairs offering the same merge used to render as three rows,
    // two of which read as the same pair reversed — five clusters ate 15 of 25
    // visible slots on dev. The union-find decides which rows exist now.
    const f = await seed()
    await pair(f, f.a, f.b)
    await pair(f, f.b, f.c)

    const result = await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    const items = result._unsafeUnwrap().items

    expect(items).toHaveLength(1)
    expect([...(items[0]?.clusterInstanceIds ?? [])].sort()).toEqual([f.a, f.b, f.c])
    // The whole component is hydrated, so the card can name all three records.
    expect(items[0]?.clusterSides.map((side) => side.instanceId).sort()).toEqual([f.a, f.b, f.c])
    expect(items[0]?.clusterSides.every((side) => side.displayName)).toBe(true)
  })

  it('keeps disjoint pairs as separate rows', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)
    await pair(f, f.c, f.d)

    const items = (
      await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    )._unsafeUnwrap().items

    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.clusterInstanceIds).toHaveLength(2)
    }
  })

  it('pages on (score desc, id desc) without repeating or skipping a row', async () => {
    const f = await seed()
    // Disjoint on purpose, so one raw row is one item and paging is what is
    // under test rather than clustering. Identical scores: `score` is a double
    // that ties constantly, so the id tiebreak is what makes the keyset total.
    await pair(f, f.a, f.b, { score: 0.9 })
    await pair(f, f.c, f.d, { score: 0.9 })
    await pair(f, f.e, f.g, { score: 0.9 })

    const first = (
      await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes, limit: 2 })
    )._unsafeUnwrap()
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = (
      await listDuplicatePairs(db(), {
        organizationId: f.orgId,
        scopes: f.scopes,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      })
    )._unsafeUnwrap()

    const ids = [...first.items, ...second.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(3)
    expect(second.nextCursor).toBeNull()
  })

  it('resumes from the last ROW read, not the last item emitted', async () => {
    // A page that collapses three rows into one item must still continue the
    // keyset from the third row, or the next page repeats what it just hid.
    const f = await seed()
    await pair(f, f.a, f.b, { score: 0.9 })
    await pair(f, f.b, f.c, { score: 0.8 })
    await pair(f, f.d, f.e, { score: 0.7 })

    const first = (
      await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes, limit: 2 })
    )._unsafeUnwrap()
    expect(first.items).toHaveLength(1)

    const second = (
      await listDuplicatePairs(db(), {
        organizationId: f.orgId,
        scopes: f.scopes,
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      })
    )._unsafeUnwrap()

    expect(second.items).toHaveLength(1)
    expect([...(second.items[0]?.clusterInstanceIds ?? [])].sort()).toEqual([f.d, f.e])
  })

  it('joins both sides’ display columns', async () => {
    const f = await seed()
    await pair(f, f.a, f.b)

    const item = (
      await listDuplicatePairs(db(), { organizationId: f.orgId, scopes: f.scopes })
    )._unsafeUnwrap().items[0]

    expect(item?.low.displayName).toBeTruthy()
    expect(item?.high.displayName).toBeTruthy()
    expect(item?.low.secondaryDisplayValue).toContain('@acme.test')
  })
})

describe('dismiss', () => {
  it('stamps `dismissedBand` from the row’s OWN stored band', async () => {
    const f = await seed()
    // A medium pair — if the band came from the caller instead of the row, a
    // stale client could stamp `high` here and permanently suppress the genuine
    // upgrade that `upsertPairs` reopens on.
    const id = await pair(f, f.a, f.b, { band: 'medium', score: 0.6 })

    const result = await dismissPair(db(), {
      organizationId: f.orgId,
      pairId: id,
      userId: f.userId,
    })

    const [row] = await db()
      .select()
      .from(schema.DuplicateSuggestion)
      .where(eq(schema.DuplicateSuggestion.id, id))

    expect(result._unsafeUnwrap()).toBe(true)
    expect(row?.status).toBe('dismissed')
    expect(row?.dismissedBand).toBe('medium')
    expect(row?.dismissedAt).toBeTruthy()
  })

  it('snoozing keeps the pair `open` and does NOT stamp a band', async () => {
    const f = await seed()
    const id = await pair(f, f.a, f.b, { band: 'medium' })
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await dismissPair(db(), {
      organizationId: f.orgId,
      pairId: id,
      userId: f.userId,
      snoozeUntil: until,
    })

    const [row] = await db()
      .select()
      .from(schema.DuplicateSuggestion)
      .where(eq(schema.DuplicateSuggestion.id, id))

    // A snooze is "not now", not a verdict on the evidence — stamping the band
    // would make the next upgrade un-noticeable for this pair.
    expect(row?.status).toBe('open')
    expect(row?.dismissedBand).toBeNull()
    expect(row?.snoozeUntil?.getTime()).toBe(until.getTime())
  })

  it('never touches a `merged` row', async () => {
    const f = await seed()
    const id = await pair(f, f.a, f.b, { status: 'merged' })

    const result = await dismissPair(db(), {
      organizationId: f.orgId,
      pairId: id,
      userId: f.userId,
    })

    expect(result._unsafeUnwrap()).toBe(false)
  })

  it('is org-scoped', async () => {
    const f = await seed()
    const other = await seed()
    const id = await pair(other, other.a, other.b)

    const result = await dismissPair(db(), {
      organizationId: f.orgId,
      pairId: id,
      userId: f.userId,
    })
    expect(result._unsafeUnwrap()).toBe(false)
  })
})

describe('getVisibleDuplicatePair — the resolve-then-authorize read', () => {
  it('refuses a pair the caller cannot see both sides of', async () => {
    const f = await seed()
    const id = await pair(f, f.a, f.b)

    const result = await getVisibleDuplicatePair(db(), {
      organizationId: f.orgId,
      pairId: id,
      scopes: onlyVisible(f, [f.a]),
    })
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('returns a dismissed pair — status is deliberately not filtered', async () => {
    const f = await seed()
    const id = await pair(f, f.a, f.b, { status: 'dismissed', dismissedBand: 'high' })

    const result = await getVisibleDuplicatePair(db(), {
      organizationId: f.orgId,
      pairId: id,
      scopes: f.scopes,
    })
    expect(result._unsafeUnwrap()?.id).toBe(id)
  })

  it('refuses a pair with an archived side', async () => {
    const f = await seed()
    const id = await pair(f, f.a, f.b)
    await archive(f.b)

    const result = await getVisibleDuplicatePair(db(), {
      organizationId: f.orgId,
      pairId: id,
      scopes: f.scopes,
    })
    expect(result._unsafeUnwrap()).toBeNull()
  })
})

describe('orderByEstablishment — which record a merge defaults INTO', () => {
  const side = (instanceId: string, over: Partial<DuplicateSide> = {}): DuplicateSide => ({
    instanceId,
    displayName: instanceId,
    secondaryDisplayValue: null,
    avatarUrl: null,
    firstInteractionAt: null,
    lastInteractionAt: null,
    createdAt: null,
    ...over,
  })

  it('prefers outbound history above everything else', () => {
    const ordered = orderByEstablishment(
      [side('zzz'), side('aaa', { createdAt: new Date('2020-01-01') })],
      [{ instanceId: 'zzz', hasOutboundHistory: true }]
    )
    expect(ordered[0]).toBe('zzz')
  })

  it('falls back to the OLDEST record when no establishment signal exists', () => {
    // The case this rung exists for, and the one the queue is full of: two
    // records the name rule paired, neither with any interaction history. The id
    // fallback is a cuid2, i.e. arbitrary — so without `createdAt` the merge
    // target was a coin flip, and half the time it was the emptier stub.
    const older = side('zzz', { createdAt: new Date('2020-01-01') })
    const newer = side('aaa', { createdAt: new Date('2026-01-01') })

    expect(orderByEstablishment([newer, older], [])[0]).toBe('zzz')
    expect(orderByEstablishment([older, newer], [])[0]).toBe('zzz')
  })

  it('ranks an interacted record above an older one with no interaction', () => {
    const stub = side('aaa', { createdAt: new Date('2019-01-01') })
    const real = side('zzz', {
      createdAt: new Date('2026-01-01'),
      firstInteractionAt: new Date('2026-02-01'),
    })
    expect(orderByEstablishment([stub, real], [])[0]).toBe('zzz')
  })
})
