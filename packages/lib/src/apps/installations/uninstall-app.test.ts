// packages/lib/src/apps/installations/uninstall-app.test.ts
// Uninstall's connector cleanup (app-fields-and-entities plan §4.4 fix 1): every
// DataConnector the uninstalled AppInstallation owns must be deleted, behavior 'keep',
// before the uninstall transaction — `deleteConnector` takes `db: Database`, not a
// transaction, so it cannot run inside it. Before this fix `deleteConnector` was only
// reachable from the tRPC router: an uninstalled app's connector survived with its
// mappings pointing at fields `deleteAppFields` had just removed, and its BullMQ schedule
// still ticking (failing auth on every run).

import { database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteConnector = vi.fn()
vi.mock('../../data-connectors/mutations', () => ({
  deleteConnector: (...args: unknown[]) => deleteConnector(...args),
}))

const deleteAppFields = vi.fn()
vi.mock('../../custom-fields/delete-field', () => ({
  deleteAppFields: (...args: unknown[]) => deleteAppFields(...args),
}))

const getSystemUser = vi.fn()
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: (...args: unknown[]) => getSystemUser(...args) }),
}))

import { uninstallApp } from './uninstall-app'

const APP = { id: 'app_1', slug: 'shopify', title: 'Shopify' }
const INSTALLATION = {
  id: 'inst_1',
  appId: 'app_1',
  organizationId: 'org_1',
  installationType: 'production',
  currentDeploymentId: 'dep_1',
  uninstalledAt: null,
}

/** A `.from().where()` chain resolving to `rows` when awaited. */
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: vi.fn(() => c),
    where: vi.fn(() => c),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return c
}

beforeEach(() => {
  deleteConnector.mockReset().mockResolvedValue({ success: true })
  deleteAppFields.mockReset().mockResolvedValue({
    isErr: () => false,
    isOk: () => true,
    value: { deletedFieldIds: [] },
  })
  getSystemUser.mockReset().mockResolvedValue('system_user_1')

  ;(database.query as unknown as Record<string, unknown>).App = {
    findFirst: vi.fn().mockResolvedValue(APP),
  }
  ;(database.query as unknown as Record<string, unknown>).AppInstallation = {
    findFirst: vi.fn().mockResolvedValue(INSTALLATION),
  }

  vi.mocked(database.select).mockReset()
  vi.mocked(database.transaction).mockReset()
  vi.mocked(database.transaction).mockImplementation((async (
    cb: (tx: unknown) => Promise<unknown>
  ) =>
    cb({
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ ...INSTALLATION }]),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    })) as never)
})

describe('uninstallApp — connector cleanup', () => {
  it('deletes every DataConnector the installation owns, behavior keep, before uninstalling', async () => {
    vi.mocked(database.select).mockImplementation(
      () => chain([{ id: 'dc_1' }, { id: 'dc_2' }]) as never
    )

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    expect(deleteConnector).toHaveBeenCalledTimes(2)
    expect(deleteConnector).toHaveBeenNthCalledWith(
      1,
      database,
      'org_1',
      'system_user_1',
      'dc_1',
      'keep'
    )
    expect(deleteConnector).toHaveBeenNthCalledWith(
      2,
      database,
      'org_1',
      'system_user_1',
      'dc_2',
      'keep'
    )
    // deleteAppFields still runs, inside the uninstall transaction, as before.
    expect(deleteAppFields).toHaveBeenCalledWith({ appInstallationId: 'inst_1' }, expect.anything())
  })

  it('skips the system-user lookup and deleteConnector entirely when the installation owns no connectors', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([]) as never)

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    expect(deleteConnector).not.toHaveBeenCalled()
    expect(getSystemUser).not.toHaveBeenCalled()
  })
})
