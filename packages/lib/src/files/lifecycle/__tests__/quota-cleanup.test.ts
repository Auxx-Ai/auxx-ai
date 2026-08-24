// packages/lib/src/files/lifecycle/__tests__/quota-cleanup.test.ts

/**
 * `lifecycle/quota-cleanup.ts` — how many bytes an organization is storing and
 * what its plan allows.
 *
 * **No `vi.mock('@auxx/database', …)`.** The measurement takes its database on a
 * `FilesCtx` now, so the shared `makeDb` stub is passed in as a parameter and
 * the whole module-scope-pool interception is gone. The one remaining `vi.mock`
 * is `FeaturePermissionService`, which `resolveStorageLimitBytes` still
 * constructs internally — that is a lib-wide service with its own database
 * binding, and giving it an injection seam is not this plan's change.
 *
 * The tests that used to drive `storageQuotaCheckJob` moved with the job to
 * `jobs/maintenance/__tests__/file-cleanup-jobs.test.ts`.
 */

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCtx, makeDb } from '../../__tests__/support'
import { calculateStorageUsage, resolveWarnThresholdBytes, UNLIMITED } from '../quota-cleanup'

const h = vi.hoisted(() => ({
  /** Raw `FeaturePermissionService.getLimit` answers, keyed by feature. */
  limits: {} as Record<string, unknown>,
}))

const getLimit = vi.fn(async (_orgId: string, key: string) => h.limits[key] ?? null)

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    getLimit = getLimit
  },
}))

const GB = 1024 * 1024 * 1024

const TABLES = {
  File: schema.File,
  FileVersion: schema.FileVersion,
  FolderFile: schema.FolderFile,
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
}

/** Aggregate row shape as node-postgres returns it: bigint sums arrive as strings. */
type AggregateRow = { totalSize: string | null; count: string }

/**
 * Queue the two outer aggregates, folder lane first.
 *
 * Only the two outer `select`s are awaited — the sub-selects end at `.as()` and
 * never resolve — so the queue holds exactly two entries. `sumFolderFileUsage`
 * reaches its `await` before `sumMediaAssetUsage` does, which fixes the order.
 */
function usage(folder: AggregateRow, media: AggregateRow) {
  return makeDb({ select: [[folder], [media]], tables: TABLES })
}

const NOTHING: AggregateRow = { totalSize: null, count: '0' }

beforeEach(() => {
  // Growth-plan shape, so the usage tests have a real denominator.
  h.limits = { storageGbHard: 50, storageGbSoft: 40 }
  getLimit.mockClear()
})

describe('calculateStorageUsage', () => {
  it('counts MediaAsset-backed storage', async () => {
    const db = usage(NOTHING, { totalSize: '1640968278', count: '3737' })

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-1' }))

    expect(quota.totalUsed).toBe(1640968278)
    expect(typeof quota.totalUsed).toBe('number')
    expect(quota.fileCount).toBe(3737)
    expect(quota.percentUsed).toBeGreaterThan(0)
  })

  it('joins FolderFile, not the empty legacy File table', async () => {
    const db = usage({ totalSize: '4096', count: '1' }, NOTHING)

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-1' }))

    expect(quota.totalUsed).toBe(4096)
    expect(quota.fileCount).toBe(1)

    // The regression this pins: joining `File` made every organization read zero
    // bytes forever, and no assertion on the returned rows could have caught it.
    const joined = db.joins.map((entry) => entry.table)
    expect(joined).toContain('FolderFile')
    expect(joined).toContain('MediaAsset')
    expect(joined).not.toContain('File')
  })

  it('sums both lanes', async () => {
    const db = usage({ totalSize: '4096', count: '1' }, { totalSize: '1000', count: '2' })

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-1' }))

    expect(quota.totalUsed).toBe(5096)
    expect(quota.fileCount).toBe(3)
  })

  it('reports zero for an organization with no stored objects', async () => {
    const db = usage(NOTHING, NOTHING)

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-empty' }))

    expect(quota.totalUsed).toBe(0)
    expect(quota.fileCount).toBe(0)
    expect(quota.percentUsed).toBe(0)
  })

  it('scopes both lanes to the ctx organization', async () => {
    const db = usage(NOTHING, NOTHING)

    await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-scoped' }))

    // One `where` per lane sub-select; both must bind the organization.
    expect(db.wheres).toHaveLength(2)
    for (const entry of db.wheres) {
      expect(JSON.stringify(collectStrings(entry.predicate))).toContain('org-scoped')
    }
  })

  it('reads quotaLimit from the plan instead of a hard-coded 50 GB', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 } // Free plan
    const db = usage(NOTHING, { totalSize: String(0.5 * GB), count: '10' })

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-free' }))

    expect(quota.quotaLimit).toBe(1 * GB)
    expect(quota.percentUsed).toBe(50)
    expect(getLimit).toHaveBeenCalledWith('org-free', 'storageGbHard')
  })

  it('reports -1 and 0% for an unlimited plan', async () => {
    h.limits = { storageGbHard: '+' } // Enterprise: seeded -1, folded to '+' by the cache
    const db = usage(NOTHING, { totalSize: String(900 * GB), count: '10' })

    const quota = await calculateStorageUsage(
      makeCtx({ db: db.db, organizationId: 'org-enterprise' })
    )

    expect(quota.quotaLimit).toBe(UNLIMITED)
    expect(quota.percentUsed).toBe(0)
  })

  it('treats a plan that names no storage limit as uncapped, not as zero bytes', async () => {
    h.limits = {} // getLimit answers null for a missing key
    const db = usage(NOTHING, { totalSize: String(5 * GB), count: '10' })

    const quota = await calculateStorageUsage(makeCtx({ db: db.db, organizationId: 'org-no-key' }))

    expect(quota.quotaLimit).toBe(UNLIMITED)
    expect(quota.percentUsed).toBe(0)
  })
})

describe('resolveWarnThresholdBytes', () => {
  it('uses the plan soft limit when it names one', async () => {
    h.limits = { storageGbHard: 10, storageGbSoft: 8 }

    expect(await resolveWarnThresholdBytes('org-starter', 10 * GB)).toBe(8 * GB)
    expect(getLimit).toHaveBeenCalledWith('org-starter', 'storageGbSoft')
  })

  it('falls back to 80% of the hard limit when the plan names no soft limit', async () => {
    h.limits = { storageGbHard: 10 }

    expect(await resolveWarnThresholdBytes('org-custom', 10 * GB)).toBe(Math.round(8 * GB))
  })

  it('has nothing to warn about on an uncapped plan', async () => {
    h.limits = {}

    expect(await resolveWarnThresholdBytes('org-enterprise', UNLIMITED)).toBeNull()
  })
})

/** Every string literal bound into a Drizzle clause. See `file-reaper.test.ts`. */
function collectStrings(clause: unknown): string[] {
  const found: string[] = []
  const seen = new Set<unknown>()

  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      found.push(node)
      return
    }
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    for (const value of Object.values(node as Record<string, unknown>)) walk(value)
  }

  walk(clause)
  return found
}
