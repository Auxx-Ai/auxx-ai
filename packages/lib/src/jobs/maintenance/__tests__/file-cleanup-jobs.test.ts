// packages/lib/src/jobs/maintenance/__tests__/file-cleanup-jobs.test.ts

/**
 * `storageQuotaCheckJob` — the daily pass over every organization.
 *
 * These moved here from `files/lifecycle/__tests__/quota-cleanup.test.ts` when
 * the job moved out of `files/`. The `vi.mock('@auxx/database')` moved with it
 * and stays: binding the process-wide pool is what a `jobs/maintenance/` handler
 * is *for*, and every peer in this folder does the same. `files/` itself is now
 * free of both the module-scope import and the mock.
 *
 * The measurement the job calls (`calculateStorageUsage`) and the threshold
 * resolution (`resolveWarnThresholdBytes`) are tested against the shared `makeDb`
 * stub, with no database mock at all, in `files/lifecycle/__tests__/`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: null as any,
  limits: {} as Record<string, unknown>,
}))

const getLimit = vi.fn(async (_orgId: string, key: string) => h.limits[key] ?? null)

vi.mock('../../../permissions/feature-permission-service', () => ({
  FeaturePermissionService: class {
    getLimit = getLimit
  },
}))

// Partial-mock the logger: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at load, so a full replacement breaks whichever test
// file happens to load it first.
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
    database: {
      select: (...args: unknown[]) => h.db.select(...args),
    },
    schema: createSchemaMock(),
    IntegrationProviderTypeValues: ['google', 'outlook'],
  }
})

import { makeDb } from '../../../files/__tests__/support'
import type { JobContext } from '../../types'
import { storageQuotaCheckJob } from '../file-cleanup-jobs'

const GB = 1024 * 1024 * 1024

/**
 * Queue what the job reads, in the order it reads it: the organization list,
 * then the two usage aggregates per organization.
 */
function seed(organizations: Array<{ id: string; name: string }>, usedBytes: number) {
  const selects: unknown[][] = [organizations]
  for (const _org of organizations) {
    selects.push([{ totalSize: '0', count: '0' }])
    selects.push([{ totalSize: String(usedBytes), count: '10' }])
  }
  h.db = makeDb({ select: selects }).db
}

function job(dryRun = false): JobContext<{ dryRun?: boolean }> {
  const data = { dryRun }
  return {
    job: { data, updateProgress: vi.fn() },
    data,
  } as unknown as JobContext<{ dryRun?: boolean }>
}

beforeEach(() => {
  h.db = null
  h.limits = {}
  getLimit.mockClear()
})

describe('storageQuotaCheckJob', () => {
  it('enforces against the org plan, not a fixed 50 GB', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 } // Free plan
    // 2 GB is comfortably under the old hard-coded 50 GB and comfortably over
    // the Free plan's real 1 GB.
    seed([{ id: 'org-free', name: 'Free Org' }], 2 * GB)

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 0, enforced: 1 })
  })

  it('warns at the soft limit, between "fine" and the hard 403', async () => {
    h.limits = { storageGbHard: 10, storageGbSoft: 8 } // Starter plan
    seed([{ id: 'org-starter', name: 'Starter Org' }], 9 * GB)

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 1, enforced: 0 })
    expect(getLimit).toHaveBeenCalledWith('org-starter', 'storageGbSoft')
  })

  it('never warns or enforces on an uncapped plan', async () => {
    h.limits = { storageGbHard: '+', storageGbSoft: '+' }
    seed([{ id: 'org-enterprise', name: 'Enterprise Org' }], 900 * GB)

    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 0, enforced: 0 })
  })

  it('does not enforce on an org just under its cap that rounds to 100%', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 }
    seed([{ id: 'org-edge', name: 'Edge Org' }], GB - 1)

    // `percentUsed` rounds to 100 here; the comparison is in bytes, so this org
    // is warned rather than enforced against.
    expect(await storageQuotaCheckJob(job())).toEqual({ checked: 1, warnings: 1, enforced: 0 })
  })

  it('counts but does not act on a dry run', async () => {
    h.limits = { storageGbHard: 1, storageGbSoft: 0.8 }
    seed([{ id: 'org-free', name: 'Free Org' }], 2 * GB)

    expect(await storageQuotaCheckJob(job(true))).toEqual({
      checked: 1,
      warnings: 0,
      enforced: 0,
    })
  })
})
