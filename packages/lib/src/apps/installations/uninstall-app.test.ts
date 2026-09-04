// packages/lib/src/apps/installations/uninstall-app.test.ts
// Uninstall's connector cleanup. INVERTED by plans/money/tasks/44 D-1/D-2: this file
// used to assert the two behaviours that were the defect —
//   1. every owned connector `deleteConnector(…, 'keep')`d, which destroyed the row and
//      with it every `DataConnectorItem` binding (connector-scoped, so a reinstall could
//      never match them and re-minted duplicates);
//   2. `deleteAppFields` running unconditionally in the same breath, which deleted the
//      values of the records step 1 had just promised to keep.
// Now: connectors are DISCONNECTED (row survives), and the field sweep does not run at
// uninstall at all. The original concern — a BullMQ schedule still ticking and failing
// auth on every run — is still covered, by `disconnectConnectors`.

import { database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disconnectConnectors = vi.fn()
const deleteConnector = vi.fn()
vi.mock('../../data-connectors/mutations', () => ({
  disconnectConnectors: (...args: unknown[]) => disconnectConnectors(...args),
  deleteConnector: (...args: unknown[]) => deleteConnector(...args),
}))

const getSystemUser = vi.fn()
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ get: (...args: unknown[]) => getSystemUser(...args) }),
}))

const deleteAppFields = vi.fn()
vi.mock('../../custom-fields/delete-field', () => ({
  deleteAppFields: (...args: unknown[]) => deleteAppFields(...args),
}))

import { uninstallApp } from './uninstall-app'
import { getLeftoverAppFields } from './uninstall-impact'

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
  disconnectConnectors.mockReset().mockResolvedValue({ disconnected: 0 })
  deleteConnector.mockReset().mockResolvedValue({ success: true })
  getSystemUser.mockReset().mockResolvedValue('system_user_1')
  deleteAppFields.mockReset().mockResolvedValue({
    isErr: () => false,
    isOk: () => true,
    value: { deletedFieldIds: [] },
  })

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
  it('DISCONNECTS every DataConnector the installation owns instead of deleting it', async () => {
    vi.mocked(database.select).mockImplementation(
      () => chain([{ id: 'dc_1' }, { id: 'dc_2' }]) as never
    )

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    // One call carrying BOTH ids, not one call per connector: the helper does a single
    // UPDATE. Asserting the ids is what pins "no connector is missed".
    expect(disconnectConnectors).toHaveBeenCalledTimes(1)
    expect(disconnectConnectors).toHaveBeenCalledWith(
      database,
      'org_1',
      ['dc_1', 'dc_2'],
      expect.stringContaining('uninstalled')
    )
  })

  it("does NOT sweep the app's custom fields — the records it just kept would be emptied", async () => {
    vi.mocked(database.select).mockImplementation(() => chain([{ id: 'dc_1' }]) as never)

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    // The inversion of the old `expect(deleteAppFields).toHaveBeenCalledWith(...)`.
    // `EntityInstance` holds no user data, so deleting these columns deletes the
    // contents of every record the disconnect above preserved. The mock stays wired
    // even though `uninstall-app` no longer imports the module: that is what makes
    // this fail if the call is ever added back.
    expect(deleteAppFields).not.toHaveBeenCalled()
  })

  it('still calls the helper with an empty list when the installation owns no connectors', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([]) as never)

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    // The helper short-circuits on an empty list itself, so the caller does not need a
    // guard — asserting the empty array keeps that contract explicit rather than
    // asserting "not called", which would break the moment the guard moved.
    expect(disconnectConnectors).toHaveBeenCalledWith(database, 'org_1', [], expect.any(String))
  })
})

// plans/money/tasks/44 D-3 — the confirm dialog's three branches reach `uninstallApp`
// as `syncedData`. `'keep'` is the default and must stay the default: every caller that
// predates the dialog gets the branch that destroys nothing.
describe('uninstallApp — record disposition', () => {
  beforeEach(() => {
    vi.mocked(database.select).mockImplementation(() => chain([{ id: 'dc_1' }]) as never)
  })

  it('defaults to keep when no disposition is passed', async () => {
    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    expect(disconnectConnectors).toHaveBeenCalled()
    expect(deleteConnector).not.toHaveBeenCalled()
  })

  it.each([
    'archive',
    'delete',
  ] as const)('tears the connectors down with behavior %s', async (syncedData) => {
    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
      syncedData,
    })

    expect(result.isOk()).toBe(true)
    expect(disconnectConnectors).not.toHaveBeenCalled()
    expect(deleteConnector).toHaveBeenCalledWith(
      database,
      'org_1',
      'system_user_1',
      'dc_1',
      syncedData
    )
  })

  it('resolves the system user ONLY on the non-keep branches', async () => {
    await uninstallApp({ appId: 'app_1', organizationId: 'org_1', uninstalledById: 'user_1' })
    // `deleteConnector`'s userId is read only where records are touched, so the keep
    // branch must not pay for a cache lookup it never uses.
    expect(getSystemUser).not.toHaveBeenCalled()

    await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
      syncedData: 'delete',
    })
    expect(getSystemUser).toHaveBeenCalled()
  })
})

// plans/money/tasks/44 D-2b — the no-connector fallback. Not an edge case: 4 of the 6
// installations owning fields on the dev org own ZERO connectors, so a purely
// connector-tied sweep would leave their columns unremovable forever.
describe('uninstallApp — the no-connector field sweep', () => {
  it('sweeps the app fields when the installation owns no connector', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([]) as never)

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    expect(deleteAppFields).toHaveBeenCalledWith({ appInstallationId: 'inst_1' }, expect.anything())
  })

  it('defers to the teardown chain when the installation DOES own a connector', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([{ id: 'dc_1' }]) as never)

    const result = await uninstallApp({
      appId: 'app_1',
      organizationId: 'org_1',
      uninstalledById: 'user_1',
    })

    expect(result.isOk()).toBe(true)
    // The columns outlive the uninstall and are swept by
    // `sweepAppFieldsIfLastConnectorGone` when that connector is finally deleted.
    expect(deleteAppFields).not.toHaveBeenCalled()
  })
})

// plans/money/tasks/44 D-5 — the leftover-fields read is what makes the removal action
// safe to offer, so its refusals matter more than its happy path.
describe('getLeftoverAppFields', () => {
  function db(opts: { uninstalled?: { id: string } | null; counts?: number[] }) {
    const findFirst = vi.fn().mockResolvedValue(opts.uninstalled ?? undefined)
    const counts = [...(opts.counts ?? [])]
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => Promise.resolve([{ n: counts.shift() ?? 0 }])),
      query: { AppInstallation: { findFirst } },
    }
    return chain
  }

  it('offers nothing when the app is still installed', async () => {
    const result = await getLeftoverAppFields(db({ uninstalled: null }) as never, 'org_1', 'app_1')
    expect(result.appInstallationId).toBeNull()
  })

  it('offers nothing once the app is reinstalled — the isNotNull filter is the guard', async () => {
    // A reinstall reactivates the SAME row with `uninstalledAt: null`, so it stops
    // matching the only query that looks for it. An earlier draft added a second
    // "is it live again?" check here; it was dead code — the first query cannot
    // return a live row — and the test for it passed with the check deleted, which is
    // how the deadness was found.
    const result = await getLeftoverAppFields(db({ uninstalled: null }) as never, 'org_1', 'app_1')
    expect(result.appInstallationId).toBeNull()
  })

  it('offers nothing when the uninstalled installation owns no columns', async () => {
    const result = await getLeftoverAppFields(
      db({ uninstalled: { id: 'inst_1' }, counts: [0] }) as never,
      'org_1',
      'app_1'
    )
    expect(result.appInstallationId).toBeNull()
  })

  it('reports the field, visible and value counts when there is something to remove', async () => {
    const result = await getLeftoverAppFields(
      db({ uninstalled: { id: 'inst_1' }, counts: [20, 4, 31737] }) as never,
      'org_1',
      'app_1'
    )
    expect(result).toEqual({
      appInstallationId: 'inst_1',
      fields: 20,
      visible: 4,
      values: 31737,
    })
  })
})
