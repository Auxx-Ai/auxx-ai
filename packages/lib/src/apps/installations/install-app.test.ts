// packages/lib/src/apps/installations/install-app.test.ts
//
// One live installation per (app, organization).
//
// Installing used to be scoped per `installationType`, so `pnpm sync-dev` on an
// app already installed from a publish created a SECOND row beside it. The two
// rows then owned separate `AppSetting`, `Credential`, `DataConnector`,
// `CustomField` and `RecordIdentity` state while presenting as one app — the
// settings page wrote `allowWrites` to production, the workflow engine executed
// the block as development, and the app's own gate refused the write.
//
// What is pinned: installing an app that is already installed on a DIFFERENT
// deployment repoints the existing installation (same id, so everything keyed by
// `appInstallationId` survives) instead of inserting; installing the deployment
// it already runs is still a no-op refusal; and reactivation matches a
// soft-deleted row of EITHER type, stamping the incoming one.

import { database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../cache/invalidate', () => ({ onCacheEvent: vi.fn() }))
vi.mock('../../data-connectors/mutations', () => ({
  reconnectConnectorsForInstallation: vi.fn(),
}))
const applyInstallationCatalog = vi.fn()
vi.mock('./app-field-provisioning', () => ({
  applyInstallationCatalog: (...a: unknown[]) => applyInstallationCatalog(...a),
}))

const { installApp } = await import('./install-app')

const PROD_DEPLOYMENT = {
  id: 'dep_prod',
  deploymentType: 'production',
  status: 'published',
  version: '0.6.0',
  createdAt: new Date('2026-09-11T18:12:00Z'),
  catalog: null,
  targetOrganizationId: null,
}
const DEV_DEPLOYMENT = {
  id: 'dep_dev',
  deploymentType: 'development',
  status: 'active',
  version: null,
  createdAt: new Date('2026-09-11T17:43:00Z'),
  catalog: null,
  targetOrganizationId: 'org_1',
}
const APP = {
  id: 'app_1',
  slug: 'shipstation',
  title: 'ShipStation',
  deployments: [PROD_DEPLOYMENT, DEV_DEPLOYMENT],
}

/** The org's existing live installation, running the published deployment. */
const LIVE_PROD_INSTALL = {
  id: 'inst_1',
  appId: 'app_1',
  organizationId: 'org_1',
  installationType: 'production',
  currentDeploymentId: 'dep_prod',
  installedAt: new Date('2026-09-11T01:23:00Z'),
  uninstalledAt: null,
}

let inserted: unknown[]
let updates: { set: Record<string, unknown> }[]
let installationFindFirst: ReturnType<typeof vi.fn>

function txReturning(row: unknown) {
  return {
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ set: values })
        return { where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([row]) })) }
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        inserted.push(v)
        return { returning: vi.fn().mockResolvedValue([{ ...LIVE_PROD_INSTALL, id: 'inst_new' }]) }
      }),
    })),
    query: { AppInstallation: { findFirst: vi.fn().mockResolvedValue(undefined) } },
  }
}

beforeEach(() => {
  inserted = []
  updates = []
  applyInstallationCatalog.mockReset().mockResolvedValue(undefined)
  installationFindFirst = vi.fn().mockResolvedValue(undefined)
  ;(database.query as unknown as Record<string, unknown>).App = {
    findFirst: vi.fn().mockResolvedValue(APP),
  }
  ;(database.query as unknown as Record<string, unknown>).AppInstallation = {
    findFirst: installationFindFirst,
  }
  vi.mocked(database.transaction).mockReset()
  vi.mocked(database.transaction).mockImplementation((async (
    cb: (tx: unknown) => Promise<unknown>
  ) =>
    cb(
      txReturning({
        ...LIVE_PROD_INSTALL,
        installationType: 'development',
        currentDeploymentId: 'dep_dev',
      })
    )) as never)
})

describe('sync-dev onto an app already installed from a publish', () => {
  it('repoints the existing installation instead of adding a second row', async () => {
    installationFindFirst.mockResolvedValue(LIVE_PROD_INSTALL)

    const result = await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'development',
      deploymentId: 'dep_dev',
    })

    expect(result.isOk()).toBe(true)
    // Same installation id — everything keyed by `appInstallationId` survives.
    expect(result.isOk() && result.value.installation.id).toBe('inst_1')
    expect(inserted.filter((v) => (v as { appId?: string }).appId === 'app_1')).toHaveLength(1) // the event log only
    expect(updates[0]?.set.currentDeploymentId).toBe('dep_dev')
    expect(updates[0]?.set.installationType).toBe('development')
  })

  it('reconciles against the INCOMING catalog, as a roll-forward does', async () => {
    installationFindFirst.mockResolvedValue(LIVE_PROD_INSTALL)

    await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'development',
      deploymentId: 'dep_dev',
    })

    expect(applyInstallationCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ appInstallationId: 'inst_1', appSlug: 'shipstation' }),
      expect.anything()
    )
  })

  it('records what it switched off, so a repoint is distinguishable in the event log', async () => {
    installationFindFirst.mockResolvedValue(LIVE_PROD_INSTALL)

    await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'development',
      deploymentId: 'dep_dev',
    })

    const event = inserted.find(
      (v) => (v as { eventType?: string }).eventType === 'app.installed'
    ) as { eventData: Record<string, unknown> }
    expect(event.eventData.switchedFromDeploymentId).toBe('dep_prod')
    expect(event.eventData.deploymentId).toBe('dep_dev')
  })
})

describe('installing the deployment it already runs', () => {
  it('is still refused as already installed — nothing to repoint', async () => {
    installationFindFirst.mockResolvedValue(LIVE_PROD_INSTALL)

    const result = await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'production',
      deploymentId: 'dep_prod',
    })

    expect(result.isErr()).toBe(true)
    expect(result.isErr() && result.error.code).toBe('APP_ALREADY_INSTALLED')
    expect(updates).toHaveLength(0)
  })
})

describe('a first install', () => {
  it('inserts when the org has no live installation', async () => {
    installationFindFirst.mockResolvedValue(undefined)

    const result = await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'production',
      deploymentId: 'dep_prod',
    })

    expect(result.isOk()).toBe(true)
    expect(inserted.some((v) => (v as { installationType?: string }).installationType)).toBe(true)
  })

  it('looks for an existing installation by app and org, NOT by installationType', async () => {
    installationFindFirst.mockResolvedValue(undefined)

    await installApp({
      appId: 'app_1',
      organizationId: 'org_1',
      installedById: 'user_1',
      installationType: 'development',
      deploymentId: 'dep_dev',
    })

    // The `where` callback is what carries the predicate. Invoke it against a
    // recording helper set and assert `installationType` is never constrained —
    // that predicate is exactly what allowed the second row.
    const where = installationFindFirst.mock.calls[0]?.[0]?.where
    const touched: string[] = []
    const cols = new Proxy({} as Record<string, string>, {
      get: (_t, k: string) => {
        touched.push(k)
        return k
      },
    })
    where(cols, { and: () => undefined, eq: () => undefined, isNull: () => undefined })
    expect(touched).toContain('appId')
    expect(touched).toContain('organizationId')
    expect(touched).not.toContain('installationType')
  })
})
