// packages/lib/src/import/resolution/__tests__/materialize-file-fetches.test.ts

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../files/fetch-remote-image', () => ({
  fetchAndStoreRemoteImage: vi.fn(),
  isRetryableFetchError: () => false,
}))
vi.mock('../../../files/lifecycle/quota-cleanup', () => ({
  UNLIMITED: -1,
  calculateStorageUsage: vi.fn(),
}))
vi.mock('../../../cache', () => ({ findCachedResource: vi.fn() }))
vi.mock('../../../cache/invalidate', () => ({ onCacheEvent: vi.fn() }))

const { fetchAndStoreRemoteImage } = await import('../../../files/fetch-remote-image')
const { calculateStorageUsage } = await import('../../../files/lifecycle/quota-cleanup')
const { materializeFileFetches } = await import('../materialize-file-fetches')
const { getFileFetchCounts } = await import('../get-file-fetch-counts')
const { loadPendingSelectCreates } = await import('../get-select-create-counts')

const fetchMock = vi.mocked(fetchAndStoreRemoteImage)
const usageMock = vi.mocked(calculateStorageUsage)

interface CapturedWrite {
  id: string
  status: string
  resolvedValues: Array<{ type: string; value?: unknown; error?: string }>
  isValid: string
  errorMessage: string | null
}

/** One row as the loader's join returns it. */
function row(
  resolutionId: string,
  url: string,
  overrides: Partial<{
    jobPropertyId: string
    sourceColumnIndex: number
    isValid: boolean
    resolvedValues: unknown
  }> = {}
) {
  return {
    resolutionId,
    jobPropertyId: 'jp-1',
    sourceColumnIndex: 2,
    sourceColumnName: 'Image',
    targetFieldKey: 'product_image',
    customFieldId: null,
    entityDefinitionId: 'product',
    organizationId: 'org-1',
    isValid: true,
    resolvedValues: [{ type: 'create', value: url, fileFetch: { url } }],
    ...overrides,
  }
}

/** Fake db: the loader's select returns `pending`; each batched write-back is rendered and captured. */
function buildFakeDb(pending: Array<Record<string, unknown>>, failOnStatement?: number) {
  const dialect = new PgDialect()
  const statements: CapturedWrite[][] = []
  const select = () => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    // biome-ignore lint/suspicious/noThenProperty: the query builder is awaited directly
    chain.then = (resolve: (v: unknown) => void) => Promise.resolve(pending).then(resolve)
    return chain
  }
  const db = {
    select,
    execute: async (query: never) => {
      if (failOnStatement !== undefined && statements.length === failOnStatement) {
        throw new Error('connection lost')
      }
      const { params } = dialect.sqlToQuery(query)
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
      statements.push(writes)
      return { rows: [] }
    },
  }
  return { db: db as never, statements }
}

const all = (statements: CapturedWrite[][]) => statements.flat()

let assetSeq = 0
beforeEach(() => {
  assetSeq = 0
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => {
    const assetId = `asset-${++assetSeq}`
    return { assetId, ref: `asset:${assetId}`, mimeType: 'image/png', size: 10 }
  })
  usageMock.mockReset()
  usageMock.mockResolvedValue({
    organizationId: 'org-1',
    totalUsed: 0,
    quotaLimit: -1,
    percentUsed: 0,
    fileCount: 0,
  })
})

const run = (db: never) =>
  materializeFileFetches(db, { organizationId: 'org-1', jobId: 'job-1', userId: 'user-1' })

describe('materializeFileFetches', () => {
  it('downloads a URL shared by two columns once and writes { ref, sourceUrl } to both rows', async () => {
    const url = 'https://cdn.example.com/a.png'
    const { db, statements } = buildFakeDb([
      row('res-1', url),
      row('res-2', url, { jobPropertyId: 'jp-2', sourceColumnIndex: 5 }),
    ])

    const result = await run(db)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toMatchObject({
      url,
      pathPrefix: 'import-images',
      purpose: 'import-image',
      name: 'a.png',
      skipQuotaCheck: true,
    })
    expect(result).toMatchObject({ downloaded: 1, failed: 0, total: 1 })
    const writes = all(statements)
    expect(writes.map((w) => w.id).sort()).toEqual(['res-1', 'res-2'])
    for (const write of writes) {
      expect(write.status).toBe('valid')
      expect(write.resolvedValues).toEqual([
        { type: 'value', value: { ref: 'asset:asset-1', sourceUrl: url } },
      ])
      expect(JSON.stringify(write.resolvedValues)).not.toContain('"url"')
    }
  })

  it('turns a failed download into an error row, not a thrown import', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Fetch failed: HTTP 404'))
    const { db, statements } = buildFakeDb([row('res-1', 'https://x.com/missing.png')])

    const result = await run(db)

    expect(result).toMatchObject({ downloaded: 0, failed: 1 })
    expect(all(statements)).toEqual([
      {
        id: 'res-1',
        status: 'error',
        resolvedValues: [{ type: 'error', error: 'Fetch failed: HTTP 404' }],
        isValid: 'false',
        errorMessage: 'Fetch failed: HTTP 404',
      },
    ])
  })

  it('writes back per chunk, so a crash mid-run keeps the images already stored', async () => {
    const pending = Array.from({ length: 60 }, (_, i) => row(`res-${i}`, `https://x.com/${i}.png`))
    // The second write-back fails: the first chunk must already be persisted.
    const { db, statements } = buildFakeDb(pending, 1)

    await expect(run(db)).rejects.toThrow('connection lost')

    expect(statements).toHaveLength(1)
    expect(statements[0]!.length).toBeGreaterThanOrEqual(25)
    expect(statements[0]!.every((w) => w.status === 'valid')).toBe(true)
  })

  it('stops downloading once the storage quota is used up', async () => {
    usageMock.mockResolvedValue({
      organizationId: 'org-1',
      totalUsed: 95,
      quotaLimit: 100,
      percentUsed: 95,
      fileCount: 1,
    })
    const pending = Array.from({ length: 6 }, (_, i) => row(`res-${i}`, `https://x.com/${i}.png`))
    const { db, statements } = buildFakeDb(pending)

    const result = await run(db)

    // The first wave (4 in flight) starts under the limit; everything after it is refused.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({ downloaded: 4, failed: 2 })
    const refused = all(statements).filter((w) => w.status === 'error')
    expect(refused).toHaveLength(2)
    expect(refused[0]!.errorMessage).toBe('Storage limit reached')
    expect(usageMock).toHaveBeenCalledTimes(1)
  })

  it('downloads an overridden URL and a multi-URL warning row, and skips a skipped value', async () => {
    const corrected = 'https://x.com/corrected.png'
    const { db, statements } = buildFakeDb([
      // An override keeps the original `error` status but carries the re-resolved marker.
      row('res-override', corrected, {
        resolvedValues: [{ type: 'create', value: corrected, fileFetch: { url: corrected } }],
      }),
      row('res-warning', 'https://x.com/first.png', {
        resolvedValues: [
          {
            type: 'warning',
            value: 'https://x.com/first.png',
            warning: 'Only the first image is used',
            fileFetch: { url: 'https://x.com/first.png' },
          },
        ],
      }),
      row('res-skip', 'https://x.com/skipped.png', { isValid: false, resolvedValues: [] }),
    ])

    await run(db)

    expect(fetchMock.mock.calls.map(([input]) => input.url).sort()).toEqual([
      corrected,
      'https://x.com/first.png',
    ])
    expect(
      all(statements)
        .map((w) => w.id)
        .sort()
    ).toEqual(['res-override', 'res-warning'])
  })
})

describe('getFileFetchCounts', () => {
  it('counts distinct URLs overall and per column', async () => {
    const { db } = buildFakeDb([
      row('res-1', 'https://x.com/a.png'),
      row('res-2', 'https://x.com/b.png'),
      row('res-3', 'https://x.com/a.png', { jobPropertyId: 'jp-2', sourceColumnIndex: 5 }),
    ])

    const counts = await getFileFetchCounts(db, 'job-1')

    expect(counts.total).toBe(2)
    expect(counts.byColumn.map((c) => [c.jobPropertyId, c.count])).toEqual([
      ['jp-1', 2],
      ['jp-2', 1],
    ])
  })
})

describe('loadPendingSelectCreates', () => {
  it('never claims a pending image download as an option to mint', async () => {
    const { db } = buildFakeDb([row('res-1', 'https://x.com/a.png')])

    expect(await loadPendingSelectCreates(db, 'job-1')).toEqual([])
  })
})
