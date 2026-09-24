// packages/lib/src/accounting/connect-and-go/__tests__/trigger.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  slug: 'acme' as string | null,
  queued: [] as unknown[][],
}))

vi.mock('../../../cache/org-cache-helpers', () => ({
  getCachedAppByInstallationId: async () => (h.slug ? { slug: h.slug, title: 'Acme' } : null),
}))
vi.mock('../../providers/provider', () => ({
  listAccountingProviderIds: () => ['acme'],
}))
vi.mock('../../../jobs/queues', () => ({
  getQueue: () => ({ add: async (...args: unknown[]) => void h.queued.push(args) }),
}))
vi.mock('../../../jobs/queues/types', () => ({ Queues: { maintenanceQueue: 'maintenance' } }))

import { runAppConnectionAddedHooks } from '../../../apps/connections/connection-added-hooks'
import { registerConnectAndGoTrigger } from '../trigger'

const ctx = {
  organizationId: 'org_1',
  appId: 'app_1',
  appInstallationId: 'inst_1',
  credentialId: 'cred_1',
  actorUserId: 'usr_1',
  userId: null as string | null,
}

beforeEach(() => {
  h.slug = 'acme'
  h.queued = []
  registerConnectAndGoTrigger()
})

describe('registerConnectAndGoTrigger', () => {
  it('queues prepare when an accounting provider app connects org-wide', async () => {
    await runAppConnectionAddedHooks(ctx)
    expect(h.queued).toEqual([
      [
        'connectAndGoPrepareJob',
        { organizationId: 'org_1', actorUserId: 'usr_1' },
        { jobId: 'connect-and-go:org_1', removeOnComplete: true, removeOnFail: true },
      ],
    ])
  })

  it('ignores other apps and personal connections', async () => {
    h.slug = 'shopify'
    await runAppConnectionAddedHooks(ctx)
    h.slug = 'acme'
    await runAppConnectionAddedHooks({ ...ctx, userId: 'usr_1' })
    expect(h.queued).toEqual([])
  })
})
