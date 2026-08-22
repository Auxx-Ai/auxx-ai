// packages/lib/src/files/lifecycle/__tests__/quota-cleanup.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: null as any,
  /** Raw `FeaturePermissionService.getLimit` answers, keyed by feature. */
  limits: {} as Record<string, unknown>,
}))

const getLimit = vi.fn(async (_orgId: string, key: string) => h.limits[key] ?? null)

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    getLimit = getLimit
  },
}))

// Partial-mock the logger: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at load, so a full replacement breaks whichever
// test file happens to load it first.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@auxx/database', async () => {
  const { createSchemaMock } = await import('../../../test/database-mock')
  return {
    // `database` is only ever reached through the test-controlled stub below.
    database: { select: (...args: unknown[]) => h.db.select(...args) },
    // Auto-vivifying + memoized, so `schema.Foo === schema.Foo` and table
    // references stay comparable by identity (columns remain `{}`).
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

import { schema } from '@auxx/database'
import { calculateStorageUsage, storageQuotaCheckJob } from '../quota-cleanup'

const GB = 1024 * 1024 * 1024

type Lane = 'folder' | 'media'

/** Aggregate row shape as node-postgres returns it: bigint sums arrive as strings. */
type AggregateRow = { totalSize: string | null; count: string }

/**
 * Identify which storage lane a query walks purely from the table references it
 * touched. Table identity is the one thing that IS assertable under this repo's
 * vitest setup (columns resolve to `{}`), and it is exactly what the bug is
 * about: the broken query joined `File` instead of `FolderFile`, and never
 * looked at `MediaAsset` at all.
 */
function laneOf(tables: unknown[]): Lane | 'org' | 'unknown' {
  if (tables.includes(schema.FileVersion) && tables.includes(schema.FolderFile)) return 'folder'
  if (tables.includes(schema.MediaAssetVersion) && tables.includes(schema.MediaAsset))
    return 'media'
  if (tables.includes(schema.Organization)) return 'org'
  return 'unknown'
}

/**
 * Minimal Drizzle-shaped stub. Sub-selects end at `.as()` and hand back a tagged
 * marker; the outer aggregate that selects `.from(marker)` resolves to the rows
 * canned for that lane. A query that reaches neither lane resolves to `[]`,
 * which is what today's broken `FileVersion ⋈ File` join does in production.
 */
function createFakeDb(
  rows: Partial<Record<Lane, AggregateRow[]>>,
  organizations: Array<{ id: string; name: string }> = []
) {
  const lanesSeen: Array<Lane | 'org' | 'unknown'> = []
  const tablesSeen: unknown[][] = []

  const select = () => {
    const tables: unknown[] = []
    let lane: Lane | 'org' | 'unknown' | undefined

    const chain: any = {
      from: (source: any) => {
        if (source && typeof source === 'object' && '__lane' in source) lane = source.__lane
        else tables.push(source)
        return chain
      },
      innerJoin: (table: unknown) => {
        tables.push(table)
        return chain
      },
      leftJoin: (table: unknown) => {
        tables.push(table)
        return chain
      },
      where: () => chain,
      groupBy: () => chain,
      as: () => {
        const resolved = laneOf(tables)
        lanesSeen.push(resolved)
        tablesSeen.push(tables)
        return { __lane: resolved }
      },
      then: (resolve: (value: any[]) => void) => {
        if (lane === undefined) {
          // Directly-awaited chain (no sub-select): record what it touched.
          const resolved = laneOf(tables)
          lanesSeen.push(resolved)
          tablesSeen.push(tables)
          if (resolved === 'org') {
            resolve(organizations)
            return
          }
          resolve(resolved === 'unknown' ? [] : (rows[resolved] ?? []))
          return
        }
        resolve(lane === 'unknown' || lane === 'org' ? [] : (rows[lane] ?? []))
      },
    }
    return chain
  }

  return { db: { select }, lanesSeen, tablesSeen }
}

describe('calculateStorageUsage', () => {
  beforeEach(() => {
    h.db = null
    // Growth-plan shape, so the usage tests have a real denominator.
    h.limits = { storageGbHard: 50, storageGbSoft: 40 }
    getLimit.mockClear()
  })

  it('counts MediaAsset-backed storage', async () => {
    const fake = createFakeDb({
      folder: [{ totalSize: null, count: '0' }],
      media: [{ totalSize: '1640968278', count: '3737' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-1')

    expect(quota.totalUsed).toBe(1640968278)
    expect(typeof quota.totalUsed).toBe('number')
    expect(quota.fileCount).toBe(3737)
    expect(quota.percentUsed).toBeGreaterThan(0)
    expect(fake.lanesSeen).toContain('media')
  })

  it('counts FolderFile-backed storage and joins FolderFile, not the legacy File table', async () => {
    const fake = createFakeDb({
      folder: [{ totalSize: '4096', count: '1' }],
      media: [{ totalSize: null, count: '0' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-1')

    expect(quota.totalUsed).toBe(4096)
    expect(quota.fileCount).toBe(1)
    expect(fake.lanesSeen).toContain('folder')

    const folderTables = fake.tablesSeen.find((tables) => laneOf(tables) === 'folder')
    expect(folderTables).toBeDefined()
    expect(folderTables).not.toContain(schema.File)
  })

  it('sums both lanes', async () => {
    const fake = createFakeDb({
      folder: [{ totalSize: '4096', count: '1' }],
      media: [{ totalSize: '1000', count: '2' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-1')

    expect(quota.totalUsed).toBe(5096)
    expect(quota.fileCount).toBe(3)
  })

  it('reports zero for an organization with no stored objects', async () => {
    const fake = createFakeDb({
      folder: [{ totalSize: null, count: '0' }],
      media: [{ totalSize: null, count: '0' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-empty')

    expect(quota.totalUsed).toBe(0)
    expect(quota.fileCount).toBe(0)
    expect(quota.percentUsed).toBe(0)
  })

  it('reads quotaLimit from the plan instead of a hard-coded 50 GB', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 } // Free plan
    const fake = createFakeDb({
      folder: [{ totalSize: null, count: '0' }],
      media: [{ totalSize: String(0.5 * GB), count: '10' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-free')

    expect(quota.quotaLimit).toBe(1 * GB)
    expect(quota.percentUsed).toBe(50)
    expect(getLimit).toHaveBeenCalledWith('org-free', 'storageGbHard')
  })

  it('reports -1 and 0% for an unlimited plan', async () => {
    h.limits = { storageGbHard: '+' } // Enterprise: seeded -1, folded to '+' by the cache
    const fake = createFakeDb({
      folder: [{ totalSize: null, count: '0' }],
      media: [{ totalSize: String(900 * GB), count: '10' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-enterprise')

    expect(quota.quotaLimit).toBe(-1)
    expect(quota.percentUsed).toBe(0)
  })

  it('treats a plan that names no storage limit as uncapped, not as zero bytes', async () => {
    h.limits = {} // getLimit answers null for a missing key
    const fake = createFakeDb({
      folder: [{ totalSize: null, count: '0' }],
      media: [{ totalSize: String(5 * GB), count: '10' }],
    })
    h.db = fake.db

    const quota = await calculateStorageUsage('org-no-key')

    expect(quota.quotaLimit).toBe(-1)
    expect(quota.percentUsed).toBe(0)
  })
})

describe('storageQuotaCheckJob', () => {
  function job() {
    const data = { dryRun: false }
    return {
      job: { data, updateProgress: vi.fn() },
      data,
    } as any
  }

  beforeEach(() => {
    h.db = null
    h.limits = {}
    getLimit.mockClear()
  })

  it('enforces against the org plan, not a fixed 50 GB', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 } // Free plan
    const fake = createFakeDb(
      {
        folder: [{ totalSize: null, count: '0' }],
        media: [{ totalSize: String(2 * GB), count: '10' }],
      },
      [{ id: 'org-free', name: 'Free Org' }]
    )
    h.db = fake.db

    // 2 GB is comfortably under the old hard-coded 50 GB and comfortably over
    // the Free plan's real 1 GB.
    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 0, enforced: 1 })
  })

  it('warns at the soft limit, between "fine" and the hard 403', async () => {
    h.limits = { storageGbHard: 10, storageGbSoft: 8 } // Starter plan
    const fake = createFakeDb(
      {
        folder: [{ totalSize: null, count: '0' }],
        media: [{ totalSize: String(9 * GB), count: '10' }],
      },
      [{ id: 'org-starter', name: 'Starter Org' }]
    )
    h.db = fake.db

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 1, enforced: 0 })
    expect(getLimit).toHaveBeenCalledWith('org-starter', 'storageGbSoft')
  })

  it('falls back to 80% of the hard limit when the plan names no soft limit', async () => {
    h.limits = { storageGbHard: 10 }
    const fake = createFakeDb(
      {
        folder: [{ totalSize: null, count: '0' }],
        media: [{ totalSize: String(8.5 * GB), count: '10' }],
      },
      [{ id: 'org-custom', name: 'Custom Org' }]
    )
    h.db = fake.db

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 1, enforced: 0 })
  })

  it('never warns or enforces on an uncapped plan', async () => {
    h.limits = { storageGbHard: '+', storageGbSoft: '+' }
    const fake = createFakeDb(
      {
        folder: [{ totalSize: null, count: '0' }],
        media: [{ totalSize: String(900 * GB), count: '10' }],
      },
      [{ id: 'org-enterprise', name: 'Enterprise Org' }]
    )
    h.db = fake.db

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 0, enforced: 0 })
  })

  it('does not enforce on an org just under its cap that rounds to 100%', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 }
    const fake = createFakeDb(
      {
        folder: [{ totalSize: null, count: '0' }],
        media: [{ totalSize: String(GB - 1), count: '10' }],
      },
      [{ id: 'org-edge', name: 'Edge Org' }]
    )
    h.db = fake.db

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 1, enforced: 0 })
  })
})
