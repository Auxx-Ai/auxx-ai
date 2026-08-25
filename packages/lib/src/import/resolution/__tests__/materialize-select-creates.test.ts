// packages/lib/src/import/resolution/__tests__/materialize-select-creates.test.ts

import { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the cache barrel WHOLESALE (partial-mocking it via importOriginal walks
// its real import graph before the mock exists). `mint-options` reaches the
// invalidation helper by its own path, so that one is mocked separately.
vi.mock('../../../cache', () => ({
  findCachedResource: vi.fn(),
}))
vi.mock('../../../cache/invalidate', () => ({
  onCacheEvent: vi.fn(),
}))

const { findCachedResource } = await import('../../../cache')
const { materializeSelectCreates } = await import('../materialize-select-creates')
const { getSelectCreateCounts } = await import('../get-select-create-counts')

const findCachedResourceMock = vi.mocked(findCachedResource)

/** The option envelope as it sits in `CustomField.options`. */
interface StoredOptions {
  allowNewOptions?: boolean
  options: Array<{ id?: string; value: string; label: string }>
}

const STEEL = { value: 'opt-steel', label: 'Steel' }
const PLASTIC = { value: 'opt-plastic', label: 'Plastic' }

/**
 * The org-cached resource every column resolves through.
 *
 * Four fields, one per arm of the authority gate: a growable custom TAGS field,
 * a system SINGLE_SELECT (configuration — refused), a custom SINGLE_SELECT that
 * never opted in (refused), and a custom SINGLE_SELECT that did.
 */
function partResource(category: StoredOptions) {
  return {
    id: 'part',
    label: 'Part',
    entityType: 'part',
    entityDefinitionId: 'def-part',
    organizationId: 'org-1',
    fields: [
      {
        id: 'cf-category',
        key: 'category',
        label: 'Category',
        fieldType: 'TAGS',
        options: category,
      },
      {
        id: 'cf-status',
        key: 'status',
        label: 'Status',
        fieldType: 'SINGLE_SELECT',
        systemAttribute: 'part_status',
        options: { options: [{ value: 'opt-active', label: 'Active' }] },
      },
      {
        id: 'cf-grade',
        key: 'grade',
        label: 'Grade',
        fieldType: 'SINGLE_SELECT',
        options: { options: [] },
      },
      {
        id: 'cf-tier',
        key: 'tier',
        label: 'Tier',
        fieldType: 'SINGLE_SELECT',
        options: { allowNewOptions: true, options: [] },
      },
    ],
  } as never
}

/** One `ImportValueResolution` row as the four-table join returns it. */
function pendingRow(
  resolutionId: string,
  label: string,
  overrides: Partial<{
    jobPropertyId: string
    sourceColumnIndex: number
    sourceColumnName: string | null
    targetFieldKey: string
    customFieldId: string | null
    resolvedValues: unknown
  }> = {}
) {
  return {
    resolutionId,
    jobPropertyId: 'jp-1',
    sourceColumnIndex: 1,
    sourceColumnName: 'Category',
    targetFieldKey: 'category',
    customFieldId: 'cf-category',
    entityDefinitionId: 'part',
    organizationId: 'org-1',
    resolvedValues: [{ type: 'create', value: label, warning: `Will create new option: ${label}` }],
    ...overrides,
  }
}

/** One row of the batched `UPDATE ... FROM (VALUES ...)`, as bound. */
interface CapturedWrite {
  id: string
  status: string
  resolvedValues: Array<{ type: string; value?: unknown; error?: string }>
  isValid: string
  errorMessage: string | null
}

/**
 * Every bound VALUE in a condition, in order.
 *
 * Under the suite's `@auxx/database` mock every schema column is `undefined`, so
 * `eq(schema.CustomField.id, fieldId)` puts the raw id straight into the SQL's
 * chunks (drizzle only wraps a value in a `Param` when the left side is a real
 * column). Reading the chunks back is what lets the fake DB tell which field the
 * minter just locked without rendering a statement it could not render.
 */
function boundValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (node instanceof SQL) {
    for (const chunk of (node as unknown as { queryChunks: unknown[] }).queryChunks) {
      boundValues(chunk, out)
    }
  }
  return out
}

/**
 * Fake db covering the three shapes this path uses: the thenable pending-create
 * select, `mintOrMatchOptions`' locked read + option update inside a
 * transaction, and the raw batched write-back rendered through the real
 * Postgres dialect so its bound parameters can be read tuple by tuple.
 *
 * The option store is MUTATED by the update, so a second read under the lock
 * sees what the first write did — that is what makes "existing options survive"
 * an assertion about the real union rather than about a stub.
 */
function buildFakeDb(
  pending: Array<Record<string, unknown>>,
  fields: Record<string, StoredOptions>
) {
  const dialect = new PgDialect()
  const statements: Array<{ sql: string; writes: CapturedWrite[] }> = []
  const optionWrites: Array<{ fieldId: string; options: StoredOptions['options'] }> = []

  const fieldIdIn = (condition: unknown) => boundValues(condition).find((v) => v in fields)

  const select = () => {
    const chain: Record<string, unknown> = {}
    let locked = false
    let condition: unknown = null
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = (c: unknown) => {
      condition = c
      return chain
    }
    chain.for = () => {
      locked = true
      return chain
    }
    chain.limit = () => chain
    // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, the query builder is awaited directly
    chain.then = (resolve: (v: unknown) => void) => {
      if (!locked) return Promise.resolve(pending).then(resolve)
      const fieldId = fieldIdIn(condition)
      return Promise.resolve(fieldId ? [{ options: fields[fieldId] }] : []).then(resolve)
    }
    return chain
  }

  const update = () => {
    const chain: Record<string, unknown> = {}
    let payload: { options?: StoredOptions } = {}
    chain.set = (values: { options?: StoredOptions }) => {
      payload = values
      return chain
    }
    chain.where = (c: unknown) => {
      const fieldId = fieldIdIn(c)
      const next = payload.options
      if (fieldId && next) {
        optionWrites.push({ fieldId, options: next.options })
        fields[fieldId] = next
      }
      return chain
    }
    // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, the query builder is awaited directly
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve)
    return chain
  }

  const db: Record<string, unknown> = {
    select,
    update,
    execute: async (query: never) => {
      const rendered = dialect.sqlToQuery(query)
      statements.push({ sql: rendered.sql, writes: writesFromParams(rendered.params) })
      return { rows: [] }
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }

  return { db: db as never, statements, optionWrites, fields }
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

beforeEach(() => {
  findCachedResourceMock.mockReset()
})

describe('materializeSelectCreates', () => {
  it('mints ONE option for two columns naming the same new label', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [{ ...STEEL }] }))
    // Two columns pointed at one "Category" field: one spells the new label
    // "Plastic", the other "plastic", and a third cell names the option that
    // already exists.
    const { db, statements, optionWrites } = buildFakeDb(
      [
        pendingRow('res-1', 'Plastic'),
        pendingRow('res-2', 'plastic', {
          jobPropertyId: 'jp-2',
          sourceColumnIndex: 4,
          sourceColumnName: 'Material',
        }),
        pendingRow('res-3', 'Steel'),
      ],
      { 'cf-category': { options: [{ ...STEEL }] } }
    )

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    expect(result.created).toBe(1)
    expect(result.byField).toEqual({ 'cf-category': 1 })
    expect(result.failures).toEqual([])
    // ONE lock, ONE append — not one per column and not one per row.
    expect(optionWrites).toHaveLength(1)
    expect(optionWrites[0]?.fieldId).toBe('cf-category')
    expect(optionWrites[0]?.options.map((o) => o.label)).toEqual(['Steel', 'Plastic'])

    const minted = optionWrites[0]?.options[1]?.value
    expect(minted).toBeTruthy()
    expect(minted).not.toBe('Plastic')

    expect(statements).toHaveLength(1)
    const byId = new Map(allWrites(statements).map((w) => [w.id, w]))
    for (const id of ['res-1', 'res-2']) {
      expect(byId.get(id)?.status).toBe('valid')
      expect(byId.get(id)?.isValid).toBe('true')
      expect(byId.get(id)?.resolvedValues).toEqual([{ type: 'value', value: minted }])
    }
    // The pre-existing option is MATCHED, never re-minted.
    expect(byId.get('res-3')?.resolvedValues).toEqual([{ type: 'value', value: 'opt-steel' }])
  })

  it('appends the UNION, so options that already existed survive', async () => {
    const stored: StoredOptions = { options: [{ ...STEEL }, { ...PLASTIC }] }
    findCachedResourceMock.mockImplementation(async () => partResource(stored))
    const { db, optionWrites, fields } = buildFakeDb([pendingRow('res-1', 'Aluminium')], {
      'cf-category': stored,
    })

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    expect(result.created).toBe(1)
    // Both originals are still there, unchanged and still first — the write is
    // the union, never the delta. Sending only the addition through
    // `updateCustomField` would cascade-delete every value keyed on them.
    expect(optionWrites[0]?.options.slice(0, 2)).toEqual([STEEL, PLASTIC])
    expect(fields['cf-category']?.options).toHaveLength(3)
    expect(fields['cf-category']?.options[2]?.label).toBe('Aluminium')
  })

  it('errors the rows of a field the authority gate refuses, without throwing', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [{ ...STEEL }] }))
    // `part_status` is a SYSTEM SINGLE_SELECT: its option set is configuration,
    // so nothing should be able to invent a status from a CSV.
    const { db, statements, optionWrites } = buildFakeDb(
      [
        pendingRow('res-1', 'Refurbished', {
          jobPropertyId: 'jp-9',
          sourceColumnIndex: 2,
          sourceColumnName: 'Status',
          targetFieldKey: 'part_status',
          customFieldId: null,
        }),
        pendingRow('res-2', 'Titanium'),
      ],
      { 'cf-category': { options: [{ ...STEEL }] } }
    )

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    // The refused column fails ITS rows; the other column still imports.
    expect(result.created).toBe(1)
    expect(result.byField).toEqual({ 'cf-category': 1 })
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.fieldId).toBeNull()
    expect(result.failures[0]?.targetFieldKey).toBe('part_status')
    expect(result.failures[0]?.error).toContain('Refurbished')
    expect(result.failures[0]?.error).toContain('Status')
    expect(optionWrites.map((w) => w.fieldId)).toEqual(['cf-category'])

    const byId = new Map(allWrites(statements).map((w) => [w.id, w]))
    expect(byId.get('res-1')?.status).toBe('error')
    expect(byId.get('res-1')?.isValid).toBe('false')
    expect(byId.get('res-1')?.resolvedValues[0]?.type).toBe('error')
    // The raw label must NOT survive as a value: it is an optionId no option owns.
    expect(byId.get('res-1')?.resolvedValues[0]).not.toHaveProperty('value')
    expect(byId.get('res-2')?.status).toBe('valid')
  })

  it('refuses a custom select that never opted in, and accepts one that did', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [{ ...STEEL }] }))
    const { db, optionWrites } = buildFakeDb(
      [
        pendingRow('res-1', 'A2', {
          jobPropertyId: 'jp-3',
          sourceColumnIndex: 5,
          sourceColumnName: 'Grade',
          targetFieldKey: 'grade',
          customFieldId: 'cf-grade',
        }),
        pendingRow('res-2', 'Gold', {
          jobPropertyId: 'jp-4',
          sourceColumnIndex: 6,
          sourceColumnName: 'Tier',
          targetFieldKey: 'tier',
          customFieldId: 'cf-tier',
        }),
      ],
      { 'cf-grade': { options: [] }, 'cf-tier': { allowNewOptions: true, options: [] } }
    )

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    expect(optionWrites.map((w) => w.fieldId)).toEqual(['cf-tier'])
    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.targetFieldKey).toBe('grade')
    expect(result.failures[0]?.error).toContain('Grade')
  })

  it('batches 1,201 rows into three statements, not 1,201', async () => {
    const total = 1201
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [] }))
    const { db, statements, optionWrites } = buildFakeDb(
      Array.from({ length: total }, (_, i) => pendingRow(`res-${i}`, `Material ${i}`)),
      { 'cf-category': { options: [] } }
    )

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    expect(result.created).toBe(total)
    // One lock for 1,201 labels, and ceil(1201 / 500) write statements — the
    // statement count tracks the ROW count, never the outcome distribution.
    expect(optionWrites).toHaveLength(1)
    expect(statements).toHaveLength(3)
    expect(statements.map((s) => s.writes.length)).toEqual([500, 500, 201])
    expect(allWrites(statements).every((w) => w.status === 'valid')).toBe(true)
  })

  it('batches a mixed success/failure job into ONE statement', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [] }))
    const { db, statements } = buildFakeDb(
      [
        pendingRow('res-1', 'Copper'),
        pendingRow('res-2', 'Discontinued', {
          jobPropertyId: 'jp-9',
          targetFieldKey: 'part_status',
          customFieldId: null,
        }),
        pendingRow('res-3', 'Brass'),
      ],
      { 'cf-category': { options: [] } }
    )

    await materializeSelectCreates(db, { organizationId: 'org-1', jobId: 'job-1' })

    expect(statements).toHaveLength(1)
    expect(
      allWrites(statements)
        .map((w) => w.id)
        .sort()
    ).toEqual(['res-1', 'res-2', 'res-3'])
  })

  it('leaves relation creates alone — they belong to the other materializer', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [] }))
    const { db, statements, optionWrites } = buildFakeDb(
      [
        pendingRow('res-1', 'Acme', {
          resolvedValues: [
            {
              type: 'create',
              value: null,
              relationCreate: {
                entityDefinitionId: 'def-company',
                matchField: 'name',
                value: 'Acme',
              },
            },
          ],
        }),
      ],
      { 'cf-category': { options: [] } }
    )

    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })

    expect(result).toEqual({ created: 0, byField: {}, failures: [] })
    expect(optionWrites).toHaveLength(0)
    expect(statements).toHaveLength(0)
  })

  it('is a no-op when the job has nothing pending', async () => {
    const { db, statements } = buildFakeDb([], {})
    const result = await materializeSelectCreates(db, {
      organizationId: 'org-1',
      jobId: 'job-1',
    })
    expect(result).toEqual({ created: 0, byField: {}, failures: [] })
    expect(statements).toHaveLength(0)
    expect(findCachedResourceMock).not.toHaveBeenCalled()
  })
})

describe('getSelectCreateCounts, the preview number', () => {
  it('names the labels that do not exist yet, and creates nothing', async () => {
    const stored: StoredOptions = { options: [{ ...STEEL }] }
    findCachedResourceMock.mockImplementation(async () => partResource(stored))
    const { db, optionWrites, statements } = buildFakeDb(
      [
        pendingRow('res-1', 'Plastic'),
        pendingRow('res-2', 'plastic', { jobPropertyId: 'jp-2', sourceColumnIndex: 4 }),
        pendingRow('res-3', 'Steel'),
        pendingRow('res-4', 'Aluminium'),
      ],
      { 'cf-category': stored }
    )

    const counts = await getSelectCreateCounts(db, 'job-1')

    // "Steel" already exists, and the two spellings of "Plastic" are one option.
    expect(counts.total).toBe(2)
    expect(counts.byField).toEqual([
      {
        fieldId: 'cf-category',
        targetFieldKey: 'category',
        fieldLabel: 'Category',
        labels: ['Plastic', 'Aluminium'],
      },
    ])
    expect(counts.byColumn).toEqual([
      {
        jobPropertyId: 'jp-1',
        sourceColumnIndex: 1,
        sourceColumnName: 'Category',
        targetFieldKey: 'category',
        fieldId: 'cf-category',
        labels: ['Plastic', 'Aluminium'],
      },
      {
        jobPropertyId: 'jp-2',
        sourceColumnIndex: 4,
        sourceColumnName: 'Category',
        targetFieldKey: 'category',
        fieldId: 'cf-category',
        labels: ['plastic'],
      },
    ])
    // A preview must never grow the taxonomy or touch a resolution.
    expect(optionWrites).toHaveLength(0)
    expect(statements).toHaveLength(0)
  })

  it('counts nothing for a field the authority gate refuses', async () => {
    findCachedResourceMock.mockImplementation(async () => partResource({ options: [] }))
    const { db } = buildFakeDb(
      [
        pendingRow('res-1', 'Refurbished', {
          jobPropertyId: 'jp-9',
          targetFieldKey: 'part_status',
          customFieldId: null,
        }),
      ],
      {}
    )

    const counts = await getSelectCreateCounts(db, 'job-1')
    expect(counts).toEqual({ total: 0, byField: [], byColumn: [] })
  })
})
