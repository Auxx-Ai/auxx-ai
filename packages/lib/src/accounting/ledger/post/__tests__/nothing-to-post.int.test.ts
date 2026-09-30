// packages/lib/src/accounting/ledger/post/__tests__/nothing-to-post.int.test.ts
//
// The rule is a GROUP BY / HAVING over real movements, so it runs against a real database
// (plans/mrp/22 §8). Run: npx vitest run --config vitest.integration.config.ts src/accounting/ledger/post

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEntityDefinitions } from '../../../../seed/entity-seeder/create-entity-defs'
import { buildsWaitingOnACost, buildsWithNothingToPost } from '../nothing-to-post'

const db = () => getTestDb() as unknown as Database

const RAW = 'inventory_raw_materials'
const FG = 'inventory_finished_goods'
const DAY = new Date('2026-03-10T07:59:59.999Z')

let organizationId: string
let partDefId: string
let buildCount = 0

async function part(): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId: partDefId,
      displayName: 'part',
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityInstance.id })
  return row!.id
}

interface Leg {
  role: string
  /** Signed extended cost; `null` is a leg still waiting for a standard. */
  cost: number | null
  type?: 'build_consume' | 'build_produce'
}

/** One build and its legs, raw inserts: no hooks, no ledger. */
async function build(legs: Leg[]): Promise<string> {
  const partId = await part()
  buildCount += 1
  const [row] = await db()
    .insert(schema.Build)
    .values({ organizationId, number: `B-${buildCount}`, partId, status: 'completed' })
    .returning({ id: schema.Build.id })
  const buildId = row!.id
  await db()
    .insert(schema.StockMovement)
    .values(
      legs.map((leg) => ({
        organizationId,
        partId,
        buildId,
        type: leg.type ?? (leg.cost != null && leg.cost > 0 ? 'build_produce' : 'build_consume'),
        quantity: leg.cost != null && leg.cost > 0 ? 1 : -1,
        extendedCostMinor: leg.cost,
        unitCostMinor: leg.cost == null ? null : Math.abs(leg.cost),
        costBasis: leg.cost == null ? ('pending' as const) : ('standard' as const),
        glRole: leg.role,
        occurredAt: DAY,
        effectiveAt: DAY,
      }))
    )
  return buildId
}

async function absorb(buildId: string, column: 'laborCost' | 'overheadCost') {
  await db()
    .update(schema.Build)
    .set({ [column]: 250 })
    .where(eq(schema.Build.id, buildId))
}

async function ids(query: PromiseLike<{ buildId: string | null }[]>): Promise<Set<string>> {
  return new Set((await query).flatMap((row) => (row.buildId ? [row.buildId] : [])))
}

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  const defs = await createEntityDefinitions(db(), organizationId)
  partDefId = defs.get('part')!.id
})

describe('buildsWithNothingToPost', () => {
  it('takes a subassembly built into Raw Materials at the value of its parts, and its reversal', async () => {
    const zeroNet = await build([
      { role: RAW, cost: 780 },
      { role: RAW, cost: -500 },
      { role: RAW, cost: -280 },
    ])
    const reversal = await build([
      { role: RAW, cost: -780, type: 'build_produce' },
      { role: RAW, cost: 500, type: 'build_consume' },
      { role: RAW, cost: 280, type: 'build_consume' },
    ])
    const found = await ids(buildsWithNothingToPost(db(), organizationId))
    expect(found.has(zeroNet)).toBe(true)
    expect(found.has(reversal)).toBe(true)
  })

  it('leaves out a build that moves value between accounts, or leaves a variance', async () => {
    const finishedGood = await build([
      { role: FG, cost: 780 },
      { role: RAW, cost: -780 },
    ])
    const variance = await build([
      { role: RAW, cost: 800 },
      { role: RAW, cost: -780 },
    ])
    const found = await ids(buildsWithNothingToPost(db(), organizationId))
    expect(found.has(finishedGood)).toBe(false)
    expect(found.has(variance)).toBe(false)
  })

  it('leaves out a build with a pending leg, which buildsWaitingOnACost names instead', async () => {
    const pending = await build([
      { role: RAW, cost: null, type: 'build_produce' },
      { role: RAW, cost: -780 },
    ])
    expect((await ids(buildsWithNothingToPost(db(), organizationId))).has(pending)).toBe(false)
    expect((await ids(buildsWaitingOnACost(db(), organizationId))).has(pending)).toBe(true)
  })

  it('leaves out a zero-net build that absorbed labour or overhead: its entry has lines', async () => {
    const labour = await build([
      { role: RAW, cost: 780 },
      { role: RAW, cost: -780 },
    ])
    const overhead = await build([
      { role: RAW, cost: 780 },
      { role: RAW, cost: -780 },
    ])
    await absorb(labour, 'laborCost')
    await absorb(overhead, 'overheadCost')
    const found = await ids(buildsWithNothingToPost(db(), organizationId))
    expect(found.has(labour)).toBe(false)
    expect(found.has(overhead)).toBe(false)
  })

  it('reads only its own organization', async () => {
    const mine = await build([
      { role: RAW, cost: 100 },
      { role: RAW, cost: -100 },
    ])
    const other = await createTestOrganization()
    expect((await ids(buildsWithNothingToPost(db(), other.id))).has(mine)).toBe(false)
  })
})
