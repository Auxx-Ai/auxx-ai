// packages/lib/src/jobs/maintenance/__tests__/sync-integrity-recovery-job.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  staleRuns: [] as Array<{ id: string; organizationId: string }>,
  staleImports: [] as Array<{ id: string; organizationId: string }>,
  getRunManifest: vi.fn(),
  getImportManifest: vi.fn(),
  integrityDoor: vi.fn(async () => {}),
  updateSet: vi.fn(),
}))

vi.mock('@auxx/database', () => {
  const DataConnectorRun = { name: 'run' }
  const ImportJob = { name: 'import' }
  return {
    schema: { DataConnectorRun, ImportJob },
    database: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === DataConnectorRun ? h.staleRuns : h.staleImports),
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          h.updateSet(values)
          return { where: async () => {} }
        },
      }),
    },
  }
})
vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn(), isNotNull: vi.fn(), lt: vi.fn() }))
vi.mock('../../../data-connectors/service', () => ({ getRunManifest: h.getRunManifest }))
vi.mock('../../../import', () => ({ getImportManifest: h.getImportManifest }))
vi.mock('../../../events/handlers/sync-finalize', () => ({ integrityDoor: h.integrityDoor }))
vi.mock('../../../record-rules/sync-manifest-collector', () => ({
  upgradeManifestV1: (m: unknown) => m,
}))

import type { JobContext } from '../../types/job-context'
import { syncIntegrityRecoveryJob } from '../sync-integrity-recovery-job'

const MANIFEST = { version: 2, touched: {}, createdRecordIds: ['def_1:f1'] }
const ctx = {} as JobContext

beforeEach(() => {
  vi.clearAllMocks()
  h.staleRuns = []
  h.staleImports = []
})

describe('syncIntegrityRecoveryJob', () => {
  it('replays a stale run and a stale import through the integrity door', async () => {
    h.staleRuns = [{ id: 'run_1', organizationId: 'org_1' }]
    h.staleImports = [{ id: 'job_1', organizationId: 'org_2' }]
    h.getRunManifest.mockResolvedValue(MANIFEST)
    h.getImportManifest.mockResolvedValue(MANIFEST)
    await syncIntegrityRecoveryJob(ctx)
    expect(h.integrityDoor).toHaveBeenCalledWith(expect.anything(), 'org_1', MANIFEST, {
      source: 'connector',
      ref: 'run_1',
    })
    expect(h.integrityDoor).toHaveBeenCalledWith(expect.anything(), 'org_2', MANIFEST, {
      source: 'import',
      ref: 'job_1',
    })
  })

  it('clears the pending mark when the manifest is past retention', async () => {
    h.staleRuns = [{ id: 'run_1', organizationId: 'org_1' }]
    h.getRunManifest.mockResolvedValue(null)
    await syncIntegrityRecoveryJob(ctx)
    expect(h.integrityDoor).not.toHaveBeenCalled()
    expect(h.updateSet).toHaveBeenCalledWith({ integrityPendingSince: null })
  })
})
