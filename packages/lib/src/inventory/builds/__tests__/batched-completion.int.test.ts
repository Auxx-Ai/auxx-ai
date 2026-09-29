// packages/lib/src/inventory/builds/__tests__/batched-completion.int.test.ts
//
// The one-pass completed build stores exactly what create + start + complete store
// (plans/mrp/10-batched-build-writes.md §5), in a bounded number of statements.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { createBuild, startBuild } from '../build-mutations'
import { completeBuild, recordCompletedBuild } from '../complete-build'
import type { CompleteBuildResult } from '../types'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'

const db = () => getTestDb() as unknown as Database

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const h = vi.hoisted(() => ({
  failPosting: false,
  /** Every entry a completion handed the poster. */
  posts: [] as Array<{ subject: { sourceId: string } } & Record<string, unknown>>,
}))

vi.mock('../../../accounting/ledger/post/post-inventory-movement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../accounting/ledger/post/post-inventory-movement')>()
  return {
    ...actual,
    postInventoryMovementInTx: (...args: Parameters<typeof actual.postInventoryMovementInTx>) => {
      if (h.failPosting) throw new Error('injected posting failure')
      h.posts.push(args[1] as unknown as (typeof h.posts)[number])
      return actual.postInventoryMovementInTx(...args)
    },
  }
})

let f: BuildFixture

beforeEach(async () => {
  h.failPosting = false
  h.posts = []
})

const COMPLETED_AT = new Date('2026-03-31T23:59:59.999Z')

/** A `planned` build started, ready for `completeBuild`. */
async function startedBuild(quantity: number): Promise<string> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: quantity,
  })
  if (created.isErr()) throw created.error
  const started = await startBuild(db(), f.organizationId, f.userId, {
    buildId: created.value.buildId,
  })
  if (started.isErr()) throw started.error
  return created.value.buildId
}

async function fieldIds(attributes: string[]): Promise<Record<string, string>> {
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes(attributes as never)
  return Object.fromEntries(
    attributes.map((attr) => [attr, (fields as Record<string, { id: string } | null>)[attr]?.id])
  ) as Record<string, string>
}

/** Movement rows, facts and the GL entry of one build's ledger, ids and times stripped. */
async function ledgerSnapshot(result: CompleteBuildResult): Promise<string> {
  const { buildId, movementIds } = result
  const rows = await db()
    .select()
    .from(schema.StockMovement)
    .where(inArray(schema.StockMovement.id, movementIds))
  const facts = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(inArray(schema.InventoryMovementFact.id, movementIds))
  // The fixture keeps no books, so the entry is compared as the build hands it to the poster.
  const posted = h.posts.find((post) => post.subject.sourceId === buildId) ?? null

  const byId = (id: string) => movementIds.indexOf(id)
  const stripped = {
    rows: [...rows]
      .sort((a, b) => byId(a.id) - byId(b.id))
      .map(({ createdAt: _c, effectiveAt: _e, ...rest }) => rest),
    facts: [...facts]
      .sort((a, b) => byId(a.id) - byId(b.id))
      .map(({ createdAt: _c, ...rest }) => rest),
    posted,
  }
  let text = JSON.stringify(stripped)
  movementIds.forEach((id, index) => {
    text = text.replaceAll(id, `MV${index}`)
  })
  return text.replaceAll(buildId, 'BUILD')
}

/** Every SQL statement any pg client ran while `fn` executed. */
async function statements(fn: () => Promise<unknown>): Promise<string[]> {
  const texts: string[] = []
  const original = pg.Client.prototype.query
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const q = args[0]
    texts.push(typeof q === 'string' ? q : ((q as { text?: string })?.text ?? ''))
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as never)
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return texts
}

describe('statements per completion', () => {
  it('a five-component completion stays under a fixed bound', async () => {
    f = await seedBuildOrg({ components: 5 })
    const buildId = await startedBuild(10)
    const count = (
      await statements(() =>
        completeBuild(db(), f.organizationId, f.userId, { buildId, quantityProduced: 10 })
      )
    ).length
    console.info(`completeBuild statements, 5 components: ${count}`)
    expect(count).toBeLessThan(55)
  })
})

describe('recordCompletedBuild — raise, start and complete in one transaction', () => {
  const input = {
    source: 'backflush' as const,
    batchRun: 7,
    completedAt: COMPLETED_AT,
    notes: 'Backflush for 2026-03-31',
  }

  /** The build record's instance columns and values, ids, times and its own number stripped. */
  async function buildSnapshot(buildId: string): Promise<string> {
    const ids = await fieldIds(['build_started_at'])
    const [instance] = await db()
      .select({
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
        searchText: schema.EntityInstance.searchText,
        createdById: schema.EntityInstance.createdById,
      })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, buildId))
    const values = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, buildId))
      .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
    const text = JSON.stringify({
      instance,
      values: values
        // `startBuild` stamps the wall clock.
        .filter((v) => v.fieldId !== ids.build_started_at)
        .map(({ id: _id, createdAt: _c, updatedAt: _u, entityId: _e, ...rest }) => rest),
      startedAt: values.some((v) => v.fieldId === ids.build_started_at),
    })
    return instance?.displayName ? text.replaceAll(instance.displayName, 'BNUM') : text
  }

  it('stores the build and its ledger as create + start + complete do', async () => {
    f = await seedBuildOrg({ components: 3 })

    const created = await createBuild(db(), f.organizationId, f.userId, {
      partId: f.producedPartId,
      quantityPlanned: 5,
      source: input.source,
      batchRun: input.batchRun,
      notes: input.notes,
    })
    if (created.isErr()) throw created.error
    const started = await startBuild(db(), f.organizationId, f.userId, {
      buildId: created.value.buildId,
    })
    if (started.isErr()) throw started.error
    const legacy = await completeBuild(db(), f.organizationId, f.userId, {
      buildId: created.value.buildId,
      quantityProduced: 5,
      completedAt: input.completedAt,
    })
    if (legacy.isErr()) throw legacy.error

    const onePass = await recordCompletedBuild(db(), f.organizationId, f.userId, {
      ...input,
      partId: f.producedPartId,
      quantity: 5,
    })
    if (onePass.isErr()) throw onePass.error

    expect(await buildSnapshot(onePass.value.buildId)).toEqual(
      await buildSnapshot(legacy.value.buildId)
    )
    expect(await ledgerSnapshot(onePass.value)).toEqual(await ledgerSnapshot(legacy.value))
  })

  it('reads no field definitions from the database once the org cache is warm', async () => {
    f = await seedBuildOrg({ components: 3 })
    const run = async () => {
      const done = await recordCompletedBuild(db(), f.organizationId, f.userId, {
        ...input,
        partId: f.producedPartId,
        quantity: 5,
      })
      if (done.isErr()) throw done.error
    }
    // Without Redis the org cache lives 100 ms in process; a frozen clock keeps it warm.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    try {
      await run()
      const sql = await statements(run)
      // The searchText refresh joins CustomField inside an UPDATE; only reads of the defs count.
      const reads = sql.filter((text) => /^select\b/i.test(text) && text.includes('"CustomField"'))
      expect(reads).toEqual([])
    } finally {
      clock.mockRestore()
    }
  })

  it('leaves no build behind when the completion is refused', async () => {
    f = await seedBuildOrg({ components: 3 })
    h.failPosting = true
    const refused = await recordCompletedBuild(db(), f.organizationId, f.userId, {
      ...input,
      partId: f.producedPartId,
      quantity: 5,
    })
    expect(refused.isErr()).toBe(true)

    const builds = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, f.organizationId),
          eq(schema.EntityInstance.entityDefinitionId, f.buildDefId)
        )
      )
    const movements = await db()
      .select({ id: schema.StockMovement.id })
      .from(schema.StockMovement)
      .where(eq(schema.StockMovement.organizationId, f.organizationId))
    expect({ builds, movements }).toEqual({ builds: [], movements: [] })
  })
})
