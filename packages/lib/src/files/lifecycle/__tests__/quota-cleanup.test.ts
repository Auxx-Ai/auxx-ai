// packages/lib/src/files/lifecycle/__tests__/quota-cleanup.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ db: null as any }))

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
import { calculateStorageUsage } from '../quota-cleanup'

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
function laneOf(tables: unknown[]): Lane | 'unknown' {
  if (tables.includes(schema.FileVersion) && tables.includes(schema.FolderFile)) return 'folder'
  if (tables.includes(schema.MediaAssetVersion) && tables.includes(schema.MediaAsset))
    return 'media'
  return 'unknown'
}

/**
 * Minimal Drizzle-shaped stub. Sub-selects end at `.as()` and hand back a tagged
 * marker; the outer aggregate that selects `.from(marker)` resolves to the rows
 * canned for that lane. A query that reaches neither lane resolves to `[]`,
 * which is what today's broken `FileVersion ⋈ File` join does in production.
 */
function createFakeDb(rows: Partial<Record<Lane, AggregateRow[]>>) {
  const lanesSeen: Array<Lane | 'unknown'> = []
  const tablesSeen: unknown[][] = []

  const select = () => {
    const tables: unknown[] = []
    let lane: Lane | 'unknown' | undefined

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
      then: (resolve: (value: AggregateRow[]) => void) => {
        if (lane === undefined) {
          // Directly-awaited chain (no sub-select): record what it touched.
          const resolved = laneOf(tables)
          lanesSeen.push(resolved)
          tablesSeen.push(tables)
          resolve(resolved === 'unknown' ? [] : (rows[resolved] ?? []))
          return
        }
        resolve(lane === 'unknown' ? [] : (rows[lane] ?? []))
      },
    }
    return chain
  }

  return { db: { select }, lanesSeen, tablesSeen }
}

describe('calculateStorageUsage', () => {
  beforeEach(() => {
    h.db = null
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
})
