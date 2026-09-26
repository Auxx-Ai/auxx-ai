// packages/lib/src/inventory/builds/__tests__/batched-backflush.int.test.ts
//
// A backflush slice written as one batch (`recordCompletedBuilds`) stores exactly what one
// `recordCompletedBuild` per build stores (plans/mrp/12-slice-batched-backflush.md §2 tests): two
// identically seeded orgs, one forced build by build, compared with every id relabelled.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { toRecordId } from '../../../resources/resource-id'
import { backflushBuilds } from '../backflush'
import { type BuildFixture, freezeStandardCost, seedBuildOrg } from './support/build-fixture'
import { insertRawMovements } from './support/raw-movements'

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))

const h = vi.hoisted(() => ({
  /** Refuse every batch, so the slice is written build by build. */
  perBuild: false,
  /** A produced standard whose builds the poster refuses. */
  refuseStandard: null as number | null,
  posts: [] as Array<Record<string, unknown>>,
  frames: [] as Array<{ event: string; data: Record<string, unknown> }>,
}))

vi.mock('../../../realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../realtime')>()
  const service = {
    publish: async (_room: string, event: string, data: Record<string, unknown>) => {
      h.frames.push({ event, data })
      return true
    },
  }
  return { ...actual, getRealtimeService: () => service }
})

vi.mock('../record-completed-builds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../record-completed-builds')>()
  const { err } = await import('neverthrow')
  return {
    ...actual,
    recordCompletedBuilds: (...args: Parameters<typeof actual.recordCompletedBuilds>) =>
      h.perBuild
        ? Promise.resolve(err(new Error('forced build by build')))
        : actual.recordCompletedBuilds(...args),
  }
})

vi.mock('../../../accounting/ledger/post/post-inventory-movement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../accounting/ledger/post/post-inventory-movement')>()
  return {
    ...actual,
    postInventoryMovementInTx: (...args: Parameters<typeof actual.postInventoryMovementInTx>) => {
      const input = args[1]
      const refuse = h.refuseStandard
      if (refuse && input.movements.some((m) => m.extendedCostMinor % refuse === 0)) {
        throw new Error('injected posting refusal')
      }
      h.posts.push(input as unknown as Record<string, unknown>)
      return actual.postInventoryMovementInTx(...args)
    },
  }
})

const db = () => getTestDb() as unknown as Database
const NOW = new Date('2026-03-20T00:00:00.000Z')
const DAYS = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']
const REFUSED_STANDARD = 77_777

beforeEach(() => {
  h.perBuild = false
  h.refuseStandard = null
  h.posts = []
  h.frames = []
})

interface Scenario {
  f: BuildFixture
  parts: Record<string, string>
}

/**
 * The lift (finished good) consumes a motor subassembly and a bolt; the motor consumes coils; a
 * cart has an uncosted wheel, so its builds are pending; a crate's builds are refused.
 */
async function seedScenario(options: {
  refusal: boolean
  days?: readonly string[]
}): Promise<Scenario> {
  const f = await seedBuildOrg({ components: 2 })
  const crud = new UnifiedCrudHandler(f.organizationId, f.userId, db())
  const [motor, bolt] = f.componentPartIds as [string, string]
  await crud.update(toRecordId(f.partDefId, motor), { part_kind: PartKind.SUBASSEMBLY })
  const part = async (title: string, kind: string, standard: number | null) => {
    const created = await crud.create(f.partDefId, {
      part_title: title,
      part_sku: `SKU-${title.toUpperCase()}`,
      part_kind: kind,
    })
    if (standard != null) await freezeStandardCost(f.organizationId, created.instance.id, standard)
    return created.instance.id
  }
  const bom = async (parent: string, child: string, quantity: number) => {
    await crud.create(f.subpartDefId, {
      subpart_parent_part: toRecordId(f.partDefId, parent),
      subpart_child_part: toRecordId(f.partDefId, child),
      subpart_quantity: quantity,
    })
  }
  const coil = await part('Coil', PartKind.COMPONENT, 300)
  await bom(motor, coil, 3)
  const cart = await part('Cart', PartKind.FINISHED_GOOD, 5_000)
  const wheel = await part('Wheel', PartKind.COMPONENT, null)
  await bom(cart, bolt, 1)
  await bom(cart, wheel, 4)
  const crate = await part('Crate', PartKind.FINISHED_GOOD, REFUSED_STANDARD)
  await bom(crate, bolt, 1)

  const days = options.days ?? DAYS
  const at = (day: string, hour: number) =>
    new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)
  const sales = days.flatMap((day, i) => [
    { partId: f.producedPartId, quantity: -(i + 2), occurredAt: at(day, 10) },
    ...(i % 2 === 1 ? [{ partId: cart, quantity: -1, occurredAt: at(day, 11) }] : []),
    ...(i === 2 ? [{ partId: motor, quantity: -1, occurredAt: at(day, 12) }] : []),
    ...(options.refusal && i === 1
      ? [{ partId: crate, quantity: -2, occurredAt: at(day, 13) }]
      : []),
  ])
  await insertRawMovements(f.organizationId, f.movementDefId, sales)
  return { f, parts: { lift: f.producedPartId, motor, bolt, coil, cart, wheel, crate } }
}

async function backflush(s: Scenario, days: readonly string[] = DAYS) {
  const result = await backflushBuilds(db(), s.f.organizationId, {
    from: days[0]!,
    to: days.at(-1)!,
    actorUserId: s.f.userId,
    now: NOW,
    sliceDays: days.length,
  })
  if (result.isErr()) throw result.error
  return result.value
}

async function fieldId(organizationId: string, attribute: string): Promise<string> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([attribute] as never)
  return (fields as Record<string, { id: string }>)[attribute]!.id
}

/** Everything the backflush wrote in one org, every id replaced by a stable label. */
async function snapshot(s: Scenario): Promise<unknown> {
  const org = s.f.organizationId
  const labels = new Map<string, string>([
    [org, 'ORG'],
    [s.f.userId, 'USER'],
  ])
  for (const [name, id] of Object.entries(s.parts)) labels.set(id, `PART:${name}`)
  const defs = await db()
    .select({ id: schema.EntityDefinition.id, entityType: schema.EntityDefinition.entityType })
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.organizationId, org))
  for (const def of defs) labels.set(def.id, `DEF:${def.entityType}`)
  const fields = await db()
    .select({ id: schema.CustomField.id, attr: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.organizationId, org))
  for (const field of fields) labels.set(field.id, `F:${field.attr}`)

  const builds = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.entityDefinitionId, s.f.buildDefId))
    .orderBy(asc(schema.EntityInstance.displayName))
  const movementsField = await fieldId(org, 'build_movements')
  const startedField = await fieldId(org, 'build_started_at')
  const partField = await fieldId(org, 'build_part')
  const completedField = await fieldId(org, 'build_completed_at')
  const movementIds: string[] = []
  // Named by part and day: two orgs walk independent parts in their own id order.
  for (const build of builds) {
    const own = await db()
      .select()
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, build.id),
          inArray(schema.FieldValue.fieldId, [partField, completedField])
        )
      )
    const partId = own.find((v) => v.fieldId === partField)?.relatedEntityId ?? ''
    const day = own.find((v) => v.fieldId === completedField)?.valueDate ?? ''
    const label = `BUILD:${labels.get(partId)}@${String(day)}`
    labels.set(build.id, label)
    if (build.displayName) labels.set(build.displayName, `NUM:${label}`)
    const legs = await db()
      .select({ id: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .where(
        and(eq(schema.FieldValue.entityId, build.id), eq(schema.FieldValue.fieldId, movementsField))
      )
      .orderBy(asc(schema.FieldValue.sortKey))
    legs.forEach((leg, j) => {
      labels.set(leg.id!, `${label}.${j}`)
      movementIds.push(leg.id!)
    })
  }
  const recordIds = [...builds.map((b) => b.id), ...movementIds]
  const instances = await db()
    .select()
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.id, recordIds))
  const values = await db()
    .select()
    .from(schema.FieldValue)
    .where(inArray(schema.FieldValue.entityId, recordIds))
  // Mirror rows on parts, in list order: which of this run's records each part lists.
  const mirrors = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, Object.values(s.parts)),
        inArray(schema.FieldValue.relatedEntityId, recordIds)
      )
    )
    .orderBy(
      asc(schema.FieldValue.entityId),
      asc(schema.FieldValue.fieldId),
      asc(schema.FieldValue.sortKey)
    )
  const facts = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(inArray(schema.InventoryMovementFact.id, movementIds))
  const qohField = await fieldId(org, 'part_quantity_on_hand')
  const qoh = await db()
    .select({ entityId: schema.FieldValue.entityId, value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, qohField),
        inArray(schema.FieldValue.entityId, Object.values(s.parts))
      )
    )
  const workItems = await db()
    .select()
    .from(schema.AccountingWorkItem)
    .where(eq(schema.AccountingWorkItem.organizationId, org))
  const posts = h.posts.filter((post) =>
    recordIds.includes((post.subject as { sourceId: string }).sourceId)
  )

  const data = {
    instances: instances.map(
      ({ createdAt: _c, updatedAt: _u, lastActivityAt: _l, ...rest }) => rest
    ),
    values: values
      .filter((v) => v.fieldId !== startedField)
      .map(({ id: _i, createdAt: _c, updatedAt: _u, ...rest }) => rest),
    // Part lists already hold earlier rows' keys, so compare order, not literal keys.
    mirrors: mirrors.map(({ id: _i, createdAt: _c, updatedAt: _u, sortKey: _s, ...rest }) => rest),
    facts: facts.map(({ createdAt: _c, ...rest }) => rest),
    qoh,
    workItems: workItems.map(
      ({ id: _i, createdAt: _c, updatedAt: _u, nextAttemptAt: _n, ...rest }) => rest
    ),
    posts,
  }
  let text = JSON.stringify(data)
  for (const [id, label] of [...labels].sort((a, b) => b[0].length - a[0].length)) {
    text = text.replaceAll(id, label)
  }
  const relabelled = JSON.parse(text) as Record<string, Array<Record<string, unknown>>>
  const canonical = (rows: Array<Record<string, unknown>>) =>
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  // Mirror order across two orgs depends on their part ids; `expectMirrorsInWalkOrder` checks it.
  for (const key of ['instances', 'values', 'mirrors', 'facts', 'qoh', 'workItems', 'posts']) {
    canonical(relabelled[key]!)
  }
  return relabelled
}

/** Every part's lists name this run's builds and legs in the order the run wrote them. */
async function expectMirrorsInWalkOrder(s: Scenario, written: Array<{ buildId: string }>) {
  const movementsField = await fieldId(s.f.organizationId, 'build_movements')
  const position = new Map<string, number>()
  for (const [index, { buildId }] of written.entries()) {
    position.set(buildId, index * 100)
    const legs = await db()
      .select({ id: schema.FieldValue.relatedEntityId })
      .from(schema.FieldValue)
      .where(
        and(eq(schema.FieldValue.entityId, buildId), eq(schema.FieldValue.fieldId, movementsField))
      )
      .orderBy(asc(schema.FieldValue.sortKey))
    legs.forEach((leg, j) => position.set(leg.id!, index * 100 + j + 1))
  }
  const rows = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, Object.values(s.parts)),
        inArray(schema.FieldValue.relatedEntityId, [...position.keys()])
      )
    )
    .orderBy(
      asc(schema.FieldValue.entityId),
      asc(schema.FieldValue.fieldId),
      asc(schema.FieldValue.sortKey)
    )
  const lists = new Map<string, number[]>()
  for (const row of rows) {
    const key = `${row.entityId}|${row.fieldId}`
    lists.set(key, [...(lists.get(key) ?? []), position.get(row.relatedEntityId!)!])
  }
  expect(lists.size).toBeGreaterThan(0)
  for (const list of lists.values()) expect(list).toEqual([...list].sort((a, b) => a - b))
}

/** SQL statements any pg client ran while `fn` executed, the in-process org cache kept warm. */
async function countStatements(fn: () => Promise<unknown>): Promise<number> {
  let count = 0
  // Without Redis the org cache lives 100 ms in process; a frozen clock keeps its reloads out.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
  const original = pg.Client.prototype.query
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    count += 1
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as never)
  try {
    await fn()
  } finally {
    spy.mockRestore()
    clock.mockRestore()
  }
  return count
}

describe('a batched backflush slice stores what one completion per build stores', () => {
  it('builds, legs, mirrors, facts, QoH, parking and postings; contiguous numbers in walk order', async () => {
    const perBuild = await seedScenario({ refusal: false })
    h.perBuild = true
    const one = await backflush(perBuild)
    h.perBuild = false
    const batched = await seedScenario({ refusal: false })
    const many = await backflush(batched)

    expect(many.failed).toEqual([])
    const plan = (s: Scenario, written: typeof many.written) => {
      const names = new Map(Object.entries(s.parts).map(([name, id]) => [id, name]))
      return written.map((b) => `${b.day} ${names.get(b.partId)} ${b.quantity}`).sort()
    }
    expect(plan(batched, many.written)).toEqual(plan(perBuild, one.written))
    // A subassembly, a pending build and several days and parts, all present.
    expect(new Set(many.written.map((b) => b.partId))).toEqual(
      new Set([batched.parts.lift, batched.parts.motor, batched.parts.cart])
    )
    expect(await snapshot(batched)).toEqual(await snapshot(perBuild))
    await expectMirrorsInWalkOrder(batched, many.written)
    await expectMirrorsInWalkOrder(perBuild, one.written)

    // `B-0001`… in the order the walk planned them.
    const buildDef = batched.f.buildDefId
    const numbers = await db()
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.entityDefinitionId, buildDef))
    const byId = new Map(numbers.map((row) => [row.id, row.displayName]))
    expect(many.written.map((b) => byId.get(b.buildId))).toEqual(
      many.written.map((_, i) => `B-${String(i + 1).padStart(4, '0')}`)
    )
  }, 180_000)

  it('isolates a refused build: the batch rolls back, the slice lands build by build', async () => {
    const perBuild = await seedScenario({ refusal: true })
    h.refuseStandard = REFUSED_STANDARD
    h.perBuild = true
    const one = await backflush(perBuild)
    h.perBuild = false
    const batched = await seedScenario({ refusal: true })
    const many = await backflush(batched)

    expect(many.failed.map((b) => [b.partId, b.day])).toEqual([
      [batched.parts.crate, '2026-03-03'],
      [batched.parts.crate, '2026-03-04'],
      [batched.parts.crate, '2026-03-05'],
    ])
    expect(one.failed).toHaveLength(many.failed.length)
    expect(many.written).toHaveLength(one.written.length)
    // The refused batch burnt its range; numbers are compared by the build they name.
    expect(await snapshot(batched)).toEqual(await snapshot(perBuild))
    await expectMirrorsInWalkOrder(batched, many.written)
  }, 180_000)
})

describe('statements per slice', () => {
  it('stay flat as the slice holds more builds', async () => {
    const days = [...DAYS, '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']
    const short = await seedScenario({ refusal: false })
    const shortCount = await countStatements(() => backflush(short))
    const long = await seedScenario({ refusal: false, days })
    let longWritten = 0
    const longCount = await countStatements(async () => {
      longWritten = (await backflush(long, days)).written.length
    })
    const perBuild = await seedScenario({ refusal: false, days })
    h.perBuild = true
    let perBuildWritten = 0
    const perBuildCount = await countStatements(async () => {
      perBuildWritten = (await backflush(perBuild, days)).written.length
    })
    h.perBuild = false
    console.info(
      `backflush slice statements: ${shortCount} (4 days), ${longCount} (8 days, ${longWritten} builds);` +
        ` build by build ${perBuildCount} (${perBuildWritten} builds, ${(perBuildCount / perBuildWritten).toFixed(1)} a build)`
    )
    expect(longWritten).toBeGreaterThan(6)
    expect(longCount - shortCount).toBeLessThanOrEqual(4)
    expect(longCount).toBeLessThan(60)
    expect(longCount).toBeLessThan(perBuildCount / 5)
  }, 180_000)
})
