// packages/lib/src/import/resolution/__tests__/materialize-relation-creates.test.ts

import { isRecordId } from '@auxx/types/resource'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseType } from '../../../resources/types'
import type { RelationCreateRequest } from '../../types/resolution'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists).
vi.mock('../../../cache', () => ({
  getCachedResource: vi.fn(),
}))

const { getCachedResource } = await import('../../../cache')
const { materializeRelationCreates } = await import('../materialize-relation-creates')
const { getRelationCreateCounts } = await import('../get-relation-create-counts')

const getCachedResourceMock = vi.mocked(getCachedResource)

const companyResource = {
  type: 'custom',
  id: 'company',
  label: 'Company',
  entityDefinitionId: 'def-company',
  organizationId: 'org-1',
  fields: [{ id: 'cf-name', key: 'name', type: BaseType.STRING }],
  display: { primaryDisplayField: { id: 'cf-name', name: 'Company Name', type: 'TEXT' } },
} as never

/** One `ImportValueResolution` row as the join returns it. */
function pendingRow(
  resolutionId: string,
  value: string,
  overrides: Partial<RelationCreateRequest> = {}
) {
  return {
    resolutionId,
    jobPropertyId: 'jp-1',
    sourceColumnIndex: 1,
    sourceColumnName: 'Supplier',
    resolvedValues: [
      {
        type: 'create',
        value: null,
        relationCreate: {
          entityDefinitionId: 'def-company',
          matchField: 'name',
          value,
          ...overrides,
        },
      },
    ],
  }
}

/** One row of the batched `UPDATE ... FROM (VALUES ...)`, as bound. */
interface CapturedWrite {
  id: string
  status: string
  resolvedValues: unknown
  isValid: string
  errorMessage: string | null
}

/**
 * Fake db: the pending-create select chain is thenable; `execute` renders the
 * raw write-back through the real Postgres dialect so its bound parameters can
 * be read back tuple by tuple.
 *
 * Rendering rather than inspecting `queryChunks` by hand is what keeps this
 * honest about parameter ORDER, which is the only thing tying an id to the
 * payload that lands on it.
 */
function buildFakeDb(rows: Array<Record<string, unknown>>) {
  const selectChain: Record<string, unknown> = {}
  selectChain.from = () => selectChain
  selectChain.innerJoin = () => selectChain
  selectChain.where = () => selectChain
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, the query builder is awaited directly
  selectChain.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve)

  const dialect = new PgDialect()
  const statements: Array<{ sql: string; writes: CapturedWrite[] }> = []
  const db = {
    select: () => selectChain,
    execute: async (query: never) => {
      const rendered = dialect.sqlToQuery(query)
      statements.push({ sql: rendered.sql, writes: writesFromParams(rendered.params) })
      return { rows: [] }
    },
  }
  return { db: db as never, statements }
}

/**
 * Split the bound parameters into tuples.
 *
 * The statement binds `updatedAt` once up front, then five values per row in
 * `(id, status, resolvedValues, isValid, errorMessage)` order.
 */
function writesFromParams(params: unknown[]): CapturedWrite[] {
  const writes: CapturedWrite[] = []
  for (let i = 1; i + 5 <= params.length; i += 5) {
    writes.push({
      id: params[i] as string,
      status: params[i + 1] as string,
      resolvedValues: JSON.parse(params[i + 2] as string),
      isValid: params[i + 3] as string,
      errorMessage: (params[i + 4] ?? null) as string | null,
    })
  }
  return writes
}

/** Every row written across every statement, in bind order. */
function allWrites(statements: Array<{ writes: CapturedWrite[] }>): CapturedWrite[] {
  return statements.flatMap((s) => s.writes)
}

const allow = { canImportTarget: () => true }

beforeEach(() => {
  getCachedResourceMock.mockReset()
  getCachedResourceMock.mockResolvedValue(companyResource)
})

describe('materializeRelationCreates', () => {
  it('mints exactly ONE record for N cells naming the same company', async () => {
    // Three resolution rows, two spellings of one supplier in one column plus
    // the same supplier reached from a second column. One company, three links.
    const { db, statements } = buildFakeDb([
      pendingRow('res-1', 'Acme Motors'),
      pendingRow('res-2', 'ACME MOTORS'),
      { ...pendingRow('res-3', 'Acme Motors'), jobPropertyId: 'jp-2', sourceColumnIndex: 4 },
    ])
    const createRecord = vi.fn(async () => ({ id: 'company-new' }))

    const result = await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(createRecord).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
    expect(result.byEntityDefinition).toEqual({ 'def-company': 1 })
    // ONE statement, not one per row, and it still covers all three
    // resolutions so every link points at the single new record.
    expect(statements).toHaveLength(1)
    expect(statements[0]?.sql).toContain('UPDATE "ImportValueResolution"')
    expect(statements[0]?.sql).toContain('FROM (VALUES')
    const writes = allWrites(statements)
    expect(writes.map((w) => w.id).sort()).toEqual(['res-1', 'res-2', 'res-3'])
    for (const write of writes) {
      expect(write.status).toBe('valid')
      expect(write.isValid).toBe('true')
      expect(write.resolvedValues).toEqual([{ type: 'value', value: 'def-company:company-new' }])
    }
  })

  it('stores the minted target as a full RecordId, the same shape the match path stores', async () => {
    // A bare `EntityInstance.id` is rejected by the write path's `recordIdSchema`
    // and the rejection is swallowed per field, so the importer used to land a
    // record with every field except the link. The RecordId is built on the
    // org's def CUID, never on the request's slug.
    const { db, statements } = buildFakeDb([
      pendingRow('res-1', 'Acme Motors', { entityDefinitionId: 'company' }),
    ])
    const createRecord = vi.fn(async () => ({ id: 'company-new' }))

    await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    const [write] = allWrites(statements)
    const value = (write?.resolvedValues as Array<{ value: string }>)[0]?.value
    expect(isRecordId(value)).toBe(true)
    expect(value).toBe('def-company:company-new')
  })

  it('mints the RAW cell onto the display field, addressed by its CustomField id', async () => {
    const { db } = buildFakeDb([pendingRow('res-1', 'Acme Motors')])
    const createRecord = vi.fn(async () => ({ id: 'company-new' }))

    await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(createRecord).toHaveBeenCalledWith('def-company', { 'cf-name': 'Acme Motors' })
  })

  it('mints distinct records for distinct values', async () => {
    const { db, statements } = buildFakeDb([
      pendingRow('res-1', 'Acme Motors'),
      pendingRow('res-2', 'Beta Ltd'),
    ])
    let n = 0
    const createRecord = vi.fn(async () => ({ id: `company-${++n}` }))

    const result = await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(createRecord).toHaveBeenCalledTimes(2)
    expect(result.created).toBe(2)
    // Two distinct outcomes, still ONE statement — the batch is keyed per row.
    expect(statements).toHaveLength(1)
    expect(allWrites(statements).map((w) => w.id)).toEqual(['res-1', 'res-2'])
  })

  it('carries each outcome to its OWN rows, so a failed mint never overwrites a success', async () => {
    // One batched statement now covers both outcomes. The payload is built per
    // bucket, so sharing a statement must not let the failure leak onto the
    // two rows the successful mint owns.
    const { db, statements } = buildFakeDb([
      pendingRow('res-1', 'Acme Motors'),
      pendingRow('res-2', 'Beta Ltd'),
      pendingRow('res-3', 'Acme Motors'),
    ])
    const createRecord = vi.fn(async (_defId: string, data: Record<string, unknown>) => {
      if (data['cf-name'] === 'Beta Ltd') throw new Error('Missing required field: Country')
      return { id: 'company-acme' }
    })

    await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(statements).toHaveLength(1)
    const writes = allWrites(statements)
    const byId = new Map(writes.map((w) => [w.id, w]))
    for (const id of ['res-1', 'res-3']) {
      expect(byId.get(id)?.status).toBe('valid')
      expect(byId.get(id)?.isValid).toBe('true')
      expect(byId.get(id)?.resolvedValues).toEqual([
        { type: 'value', value: 'def-company:company-acme' },
      ])
      expect(byId.get(id)?.errorMessage).toBeNull()
    }
    expect(byId.get('res-2')?.status).toBe('error')
    expect(byId.get('res-2')?.isValid).toBe('false')
    expect(byId.get('res-2')?.errorMessage).toContain('Beta Ltd')
  })

  it('batches 1,201 distinct new suppliers into three statements, not 1,201', async () => {
    const total = 1201
    const { db, statements } = buildFakeDb(
      Array.from({ length: total }, (_, i) => pendingRow(`res-${i}`, `Supplier ${i}`))
    )
    let n = 0
    const createRecord = vi.fn(async () => ({ id: `company-${n++}` }))

    const result = await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(result.created).toBe(total)
    // ceil(1201 / 500) — the write count no longer tracks the mint count.
    expect(statements).toHaveLength(3)
    expect(statements.map((s) => s.writes.length)).toEqual([500, 500, 201])
    const writes = allWrites(statements)
    expect(writes).toHaveLength(total)
    expect(writes[0]?.resolvedValues).toEqual([{ type: 'value', value: 'def-company:company-0' }])
    expect(writes[total - 1]?.resolvedValues).toEqual([
      { type: 'value', value: `def-company:company-${total - 1}` },
    ])
  })

  it('records a failed mint as a row error instead of a phantom link', async () => {
    const { db, statements } = buildFakeDb([pendingRow('res-1', 'Acme Motors')])
    const createRecord = vi.fn(async () => {
      throw new Error('Missing required field: Country')
    })

    const result = await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })

    expect(result.created).toBe(0)
    expect(result.failures[0]?.error).toContain('Country')
    const writes = allWrites(statements)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.id).toBe('res-1')
    expect(writes[0]?.status).toBe('error')
    expect(writes[0]?.isValid).toBe('false')
  })

  it('refuses to write anything when the actor may not import the TARGET def', async () => {
    const { db, statements } = buildFakeDb([pendingRow('res-1', 'Acme Motors')])
    const createRecord = vi.fn(async () => ({ id: 'company-new' }))

    await expect(
      materializeRelationCreates(db, {
        organizationId: 'org-1',
        jobId: 'job-1',
        userId: 'user-1',
        createRecord,
        canImportTarget: () => false,
      })
    ).rejects.toThrow(/permission/i)

    expect(createRecord).not.toHaveBeenCalled()
    expect(statements).toHaveLength(0)
  })

  it('is a no-op when the job has nothing pending', async () => {
    const { db } = buildFakeDb([])
    const createRecord = vi.fn()
    const result = await materializeRelationCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
      userId: 'user-1',
      createRecord,
      ...allow,
    })
    expect(result).toEqual({ created: 0, byEntityDefinition: {}, failures: [] })
    expect(createRecord).not.toHaveBeenCalled()
  })
})

describe('getRelationCreateCounts, the preview number', () => {
  it('counts DISTINCT targets, so it equals what the materializer will mint', async () => {
    const { db } = buildFakeDb([
      pendingRow('res-1', 'Acme Motors'),
      pendingRow('res-2', 'ACME MOTORS'),
      pendingRow('res-3', 'Beta Ltd'),
    ])
    const counts = await getRelationCreateCounts(db, 'job-1')

    expect(counts.total).toBe(2)
    expect(counts.byEntityDefinition).toEqual({ 'def-company': 2 })
    expect(counts.byColumn).toHaveLength(1)
    expect(counts.byColumn[0]).toMatchObject({
      sourceColumnIndex: 1,
      sourceColumnName: 'Supplier',
      entityDefinitionId: 'def-company',
      matchField: 'name',
      values: ['Acme Motors', 'Beta Ltd'],
    })
  })

  it("ignores 'create' resolutions that are not relation creates (select:create)", async () => {
    const { db } = buildFakeDb([
      { ...pendingRow('res-1', 'Acme'), resolvedValues: [{ type: 'create', value: 'New Option' }] },
    ])
    const counts = await getRelationCreateCounts(db, 'job-1')
    expect(counts.total).toBe(0)
  })
})
