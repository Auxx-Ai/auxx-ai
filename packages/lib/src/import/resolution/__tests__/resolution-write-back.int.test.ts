// packages/lib/src/import/resolution/__tests__/resolution-write-back.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts) for the batched
// `ImportValueResolution` write-back both resolution paths now share, plus the
// flat pending-lookup read.
//
// Why integration and not unit: the write-back no longer goes through the
// Drizzle update builder. `write-resolution-rows.ts` emits one raw
// `UPDATE ... FROM (VALUES ...)` per chunk, joined either on the primary key or
// on the `ImportValueResolution_propertyId_hash_key` pair. Every VALUES
// parameter reaches Postgres as `unknown` and is resolved to `text`, so the
// statement only works because of its explicit per-column casts back to the
// enum, jsonb and boolean column types. A fake-db test sees none of that: it
// would assert the rendered SQL and stay green while Postgres rejected it. Only
// real SQL can show that the rows actually change, that a row sharing a hash
// under a DIFFERENT column is left alone, and that a failed mint's error never
// lands on the rows a successful mint owns while they share one statement.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseType } from '../../../resources/types'

// `mintTarget` reads the relation target from the org cache. Mocked WHOLESALE
// (partial-mocking it via importOriginal walks its real import graph), which
// also keeps this file off Redis.
vi.mock('../../../cache', () => ({ getCachedResource: vi.fn() }))

const { getCachedResource } = await import('../../../cache')
const { getPendingRelationLookups } = await import('../get-pending-relation-lookups')
const { materializeRelationCreates } = await import('../materialize-relation-creates')
const { updateResolutionsWithLookupResults } = await import('../resolve-relation-lookups')
type RelationLookupResult = Parameters<typeof updateResolutionsWithLookupResults>[1][number]

const companyResource = {
  type: 'custom',
  id: 'company',
  label: 'Company',
  entityDefinitionId: 'def-company',
  organizationId: 'org-1',
  fields: [{ id: 'cf-name', key: 'name', type: BaseType.STRING }],
  display: { primaryDisplayField: { id: 'cf-name', name: 'Company Name', type: 'TEXT' } },
} as never

type TestDb = ReturnType<typeof getTestDb>

/** A job with its mapping, ready for columns to be hung off it. */
async function createJob(
  db: TestDb,
  organizationId: string
): Promise<{ jobId: string; mappingId: string }> {
  const mappingId = generateId()
  await db.insert(schema.ImportMapping).values({
    id: mappingId,
    organizationId,
    entityDefinitionId: 'part',
    title: 'Parts',
    updatedAt: new Date(),
  } as typeof schema.ImportMapping.$inferInsert)

  const jobId = generateId()
  await db.insert(schema.ImportJob).values({
    id: jobId,
    organizationId,
    importMappingId: mappingId,
    sourceFileName: 'parts.csv',
    columnCount: 4,
    rowCount: 10,
    updatedAt: new Date(),
  } as typeof schema.ImportJob.$inferInsert)

  return { jobId, mappingId }
}

/** One mapped column plus its job-side twin, returns the job property id. */
async function addColumn(
  db: TestDb,
  ids: { jobId: string; mappingId: string },
  sourceColumnIndex: number
): Promise<string> {
  const mappingPropertyId = generateId()
  await db.insert(schema.ImportMappingProperty).values({
    id: mappingPropertyId,
    importMappingId: ids.mappingId,
    sourceColumnIndex,
    sourceColumnName: `Column ${sourceColumnIndex}`,
    updatedAt: new Date(),
  } as typeof schema.ImportMappingProperty.$inferInsert)

  const jobPropertyId = generateId()
  await db.insert(schema.ImportJobProperty).values({
    id: jobPropertyId,
    importJobId: ids.jobId,
    importMappingPropertyId: mappingPropertyId,
    updatedAt: new Date(),
  } as typeof schema.ImportJobProperty.$inferInsert)
  return jobPropertyId
}

/** Seeds a resolution stamped at the epoch, so any rewrite is visible. */
async function addResolution(
  db: TestDb,
  jobPropertyId: string,
  hashedValue: string,
  rawValue: string,
  overrides: { resolvedValues?: unknown; status?: 'pending' | 'create' | 'valid' } = {}
): Promise<string> {
  const id = generateId()
  await db.insert(schema.ImportValueResolution).values({
    id,
    importJobPropertyId: jobPropertyId,
    hashedValue,
    rawValue,
    resolvedValues: overrides.resolvedValues ?? [
      { type: 'value', value: { __pendingRelationLookup: true } },
    ],
    status: overrides.status ?? 'pending',
    isValid: true,
    updatedAt: new Date(0),
  } as typeof schema.ImportValueResolution.$inferInsert)
  return id
}

/** A `status: 'create'` resolution, the shape `materializeRelationCreates` loads. */
function pendingCreate(value: string): { resolvedValues: unknown; status: 'create' } {
  return {
    status: 'create',
    resolvedValues: [
      {
        type: 'create',
        value: null,
        relationCreate: { entityDefinitionId: 'def-company', matchField: 'name', value },
      },
    ],
  }
}

async function readRow(db: TestDb, id: string) {
  const rows = await db
    .select()
    .from(schema.ImportValueResolution)
    .where(eq(schema.ImportValueResolution.id, id))
  return rows[0]
}

/** Counts the raw statements the write-back emits (nothing else uses `execute`). */
function spyOnExecute(db: TestDb) {
  return vi.spyOn(db as unknown as { execute: (...args: never[]) => unknown }, 'execute')
}

describe('updateResolutionsWithLookupResults, keyed on the column-plus-hash pair', () => {
  let db: TestDb
  let ids: { jobId: string; mappingId: string }

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    ids = await createJob(db, org.id)
  })

  it('writes all four outcomes in one statement', async () => {
    const jobPropertyId = await addColumn(db, ids, 1)
    const matched = await addResolution(db, jobPropertyId, 'h-matched', 'Acme')
    const created = await addResolution(db, jobPropertyId, 'h-create', 'Beta')
    const blanked = await addResolution(db, jobPropertyId, 'h-blank', 'Gamma')
    const errored = await addResolution(db, jobPropertyId, 'h-error', 'Delta')

    const results: RelationLookupResult[] = [
      { hash: 'h-matched', jobPropertyId, recordId: 'rec-1', outcome: 'matched' },
      {
        hash: 'h-create',
        jobPropertyId,
        recordId: null,
        outcome: 'create',
        create: { entityDefinitionId: 'def-company', matchField: 'name', value: 'Beta' },
      },
      { hash: 'h-blank', jobPropertyId, recordId: null, outcome: 'blank' },
      {
        hash: 'h-error',
        jobPropertyId,
        recordId: null,
        outcome: 'error',
        error: 'No match found for "Delta"',
      },
    ]

    const execute = spyOnExecute(db)
    await updateResolutionsWithLookupResults(db as never, results)
    expect(execute).toHaveBeenCalledTimes(1)
    execute.mockRestore()

    const matchedRow = await readRow(db, matched)
    expect(matchedRow?.status).toBe('valid')
    expect(matchedRow?.isValid).toBe(true)
    expect(matchedRow?.resolvedValues).toEqual([{ type: 'value', value: 'rec-1' }])
    expect(matchedRow?.errorMessage).toBeNull()
    // Proves the row was rewritten, the seed stamped the epoch.
    expect(matchedRow?.updatedAt.getTime()).toBeGreaterThan(0)

    const createdRow = await readRow(db, created)
    expect(createdRow?.status).toBe('create')
    expect(createdRow?.isValid).toBe(true)
    expect(createdRow?.resolvedValues).toEqual([
      {
        type: 'create',
        value: null,
        relationCreate: { entityDefinitionId: 'def-company', matchField: 'name', value: 'Beta' },
      },
    ])

    const blankedRow = await readRow(db, blanked)
    expect(blankedRow?.status).toBe('valid')
    expect(blankedRow?.resolvedValues).toEqual([{ type: 'value', value: null }])

    const erroredRow = await readRow(db, errored)
    expect(erroredRow?.status).toBe('error')
    expect(erroredRow?.isValid).toBe(false)
    expect(erroredRow?.errorMessage).toBe('No match found for "Delta"')
    expect(erroredRow?.resolvedValues).toEqual([
      { type: 'error', error: 'No match found for "Delta"' },
    ])
  })

  it('joins on the propertyId AND hash pair, never the hash alone', async () => {
    // The same supplier name in two mapped columns hashes identically. Keying
    // on the hash alone would rewrite both from one column's result.
    const columnA = await addColumn(db, ids, 1)
    const columnB = await addColumn(db, ids, 2)
    const target = await addResolution(db, columnA, 'h-shared', 'Acme')
    const bystander = await addResolution(db, columnB, 'h-shared', 'Acme')

    await updateResolutionsWithLookupResults(db as never, [
      { hash: 'h-shared', jobPropertyId: columnA, recordId: 'rec-1', outcome: 'matched' },
    ])

    expect((await readRow(db, target))?.status).toBe('valid')
    expect((await readRow(db, bystander))?.status).toBe('pending')
    expect((await readRow(db, bystander))?.updatedAt.getTime()).toBe(0)
  })

  it('updates every row across chunk boundaries', async () => {
    // 1,201 distinct values is three chunks at the 500 tuple limit, with a
    // short final one — the off-by-one the loop is easiest to get wrong on.
    const jobPropertyId = await addColumn(db, ids, 1)
    const total = 1201
    for (let i = 0; i < total; i++) {
      await addResolution(db, jobPropertyId, `h-${i}`, `Supplier ${i}`)
    }

    const execute = spyOnExecute(db)
    await updateResolutionsWithLookupResults(
      db as never,
      Array.from({ length: total }, (_, i) => ({
        hash: `h-${i}`,
        jobPropertyId,
        recordId: `rec-${i}`,
        outcome: 'matched' as const,
      }))
    )
    expect(execute).toHaveBeenCalledTimes(3)
    execute.mockRestore()

    const written = await db
      .select()
      .from(schema.ImportValueResolution)
      .where(eq(schema.ImportValueResolution.importJobPropertyId, jobPropertyId))
    expect(written).toHaveLength(total)
    expect(written.every((r) => r.status === 'valid')).toBe(true)
    expect(written.find((r) => r.hashedValue === 'h-0')?.resolvedValues).toEqual([
      { type: 'value', value: 'rec-0' },
    ])
    expect(written.find((r) => r.hashedValue === `h-${total - 1}`)?.resolvedValues).toEqual([
      { type: 'value', value: `rec-${total - 1}` },
    ])
  })

  it('is a no-op on an empty result set', async () => {
    const jobPropertyId = await addColumn(db, ids, 1)
    const untouched = await addResolution(db, jobPropertyId, 'h-1', 'Acme')
    const execute = spyOnExecute(db)
    await updateResolutionsWithLookupResults(db as never, [])
    expect(execute).not.toHaveBeenCalled()
    execute.mockRestore()
    expect((await readRow(db, untouched))?.status).toBe('pending')
  })
})

describe('materializeRelationCreates write-back, keyed on the primary key', () => {
  let db: TestDb
  let organizationId: string
  let ids: { jobId: string; mappingId: string }

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
    ids = await createJob(db, organizationId)
    vi.mocked(getCachedResource).mockReset()
    vi.mocked(getCachedResource).mockResolvedValue(companyResource)
  })

  it('rewrites 1,201 minted suppliers in three statements, not 1,201', async () => {
    const jobPropertyId = await addColumn(db, ids, 1)
    const total = 1201
    const resolutionIds: string[] = []
    for (let i = 0; i < total; i++) {
      resolutionIds.push(
        await addResolution(
          db,
          jobPropertyId,
          `h-${i}`,
          `Supplier ${i}`,
          pendingCreate(`Supplier ${i}`)
        )
      )
    }

    let minted = 0
    const execute = spyOnExecute(db)
    const result = await materializeRelationCreates(db as never, {
      organizationId,
      jobId: ids.jobId,
      userId: 'user-1',
      createRecord: async () => ({ id: `company-${minted++}` }),
      canImportTarget: () => true,
    })
    // ceil(1201 / 500) — the write count no longer tracks the mint count.
    expect(execute).toHaveBeenCalledTimes(3)
    execute.mockRestore()

    expect(result.created).toBe(total)
    const written = await db
      .select()
      .from(schema.ImportValueResolution)
      .where(eq(schema.ImportValueResolution.importJobPropertyId, jobPropertyId))
    expect(written).toHaveLength(total)
    expect(written.every((r) => r.status === 'valid' && r.isValid)).toBe(true)
    expect(written.every((r) => r.updatedAt.getTime() > 0)).toBe(true)
    // Every row carries a real company id, and no two rows share one.
    const linked = written.map((r) => (r.resolvedValues as Array<{ value: string }>)[0]?.value)
    expect(new Set(linked).size).toBe(total)
    expect(linked.every((v) => typeof v === 'string' && v.startsWith('company-'))).toBe(true)
  })

  it('carries each outcome to its OWN rows when a failed mint shares the statement', async () => {
    const columnA = await addColumn(db, ids, 1)
    const columnB = await addColumn(db, ids, 2)
    // Acme reached from two columns is ONE mint and two links; Beta fails.
    const acmeA = await addResolution(
      db,
      columnA,
      'h-acme',
      'Acme Motors',
      pendingCreate('Acme Motors')
    )
    const acmeB = await addResolution(
      db,
      columnB,
      'h-acme',
      'Acme Motors',
      pendingCreate('Acme Motors')
    )
    const beta = await addResolution(db, columnA, 'h-beta', 'Beta Ltd', pendingCreate('Beta Ltd'))

    const execute = spyOnExecute(db)
    const result = await materializeRelationCreates(db as never, {
      organizationId,
      jobId: ids.jobId,
      userId: 'user-1',
      createRecord: async (_defId, data) => {
        if (data['cf-name'] === 'Beta Ltd') throw new Error('Missing required field: Country')
        return { id: 'company-acme' }
      },
      canImportTarget: () => true,
    })
    // Both outcomes ride one statement — that is exactly the risk being pinned.
    expect(execute).toHaveBeenCalledTimes(1)
    execute.mockRestore()

    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(1)

    for (const id of [acmeA, acmeB]) {
      const row = await readRow(db, id)
      expect(row?.status).toBe('valid')
      expect(row?.isValid).toBe(true)
      expect(row?.resolvedValues).toEqual([{ type: 'value', value: 'company-acme' }])
      expect(row?.errorMessage).toBeNull()
    }

    const betaRow = await readRow(db, beta)
    expect(betaRow?.status).toBe('error')
    expect(betaRow?.isValid).toBe(false)
    expect(betaRow?.errorMessage).toContain('Beta Ltd')
    expect(betaRow?.resolvedValues).toEqual([
      { type: 'error', error: 'Could not create "Beta Ltd": Missing required field: Country' },
    ])
  })

  it('leaves a settled resolution alone', async () => {
    const jobPropertyId = await addColumn(db, ids, 1)
    const settled = await addResolution(db, jobPropertyId, 'h-settled', 'Already linked', {
      status: 'valid',
      resolvedValues: [{ type: 'value', value: 'rec-existing' }],
    })

    await materializeRelationCreates(db as never, {
      organizationId,
      jobId: ids.jobId,
      userId: 'user-1',
      createRecord: async () => ({ id: 'company-new' }),
      canImportTarget: () => true,
    })

    const row = await readRow(db, settled)
    expect(row?.status).toBe('valid')
    expect(row?.resolvedValues).toEqual([{ type: 'value', value: 'rec-existing' }])
    expect(row?.updatedAt.getTime()).toBe(0)
  })
})

describe('getPendingRelationLookups', () => {
  let db: TestDb
  let organizationId: string

  beforeEach(async () => {
    db = getTestDb()
    const org = await createTestOrganization()
    organizationId = org.id
  })

  it('reads every mapped column in one pass and keeps each hit on its own column', async () => {
    const ids = await createJob(db, organizationId)
    const jobPropertyIds: string[] = []

    for (const sourceColumnIndex of [1, 2, 3]) {
      const jobPropertyId = await addColumn(db, ids, sourceColumnIndex)
      jobPropertyIds.push(jobPropertyId)
      await addResolution(
        db,
        jobPropertyId,
        `h-${sourceColumnIndex}`,
        `Value ${sourceColumnIndex}`,
        {
          resolvedValues: [
            {
              type: 'value',
              value: {
                __pendingRelationLookup: true,
                targetTable: 'company',
                matchField: 'name',
                searchValue: `Value ${sourceColumnIndex}`,
                __onNoMatch: 'create',
              },
            },
          ],
        }
      )
    }

    // A resolved (non-marker) row must not be reported as pending.
    await addResolution(db, jobPropertyIds[0]!, 'h-settled', 'Settled', {
      status: 'valid',
      resolvedValues: [{ type: 'value', value: 'rec-1' }],
    })

    const pending = await getPendingRelationLookups(db as never, ids.jobId)

    expect(pending).toHaveLength(3)
    for (const [index, jobPropertyId] of jobPropertyIds.entries()) {
      const hit = pending.find((p) => p.hash === `h-${index + 1}`)
      expect(hit?.jobPropertyId).toBe(jobPropertyId)
      expect(hit?.entityDefinitionId).toBe('company')
      expect(hit?.onNoMatch).toBe('create')
      expect(hit?.searchValue).toBe(`Value ${index + 1}`)
    }
  })

  it('returns nothing for a job with no mapped columns', async () => {
    const ids = await createJob(db, organizationId)
    await expect(getPendingRelationLookups(db as never, ids.jobId)).resolves.toEqual([])
  })
})
