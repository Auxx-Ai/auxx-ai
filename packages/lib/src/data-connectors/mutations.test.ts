// packages/lib/src/data-connectors/mutations.test.ts
// `finalizeConnectorTeardown`'s `delete` behavior stray-field sweep (app-fields-and-entities plan
// §4.4, fix 2): an app connector's contributing columns on a SHARED def carry
// `appInstallationId` alongside `dataConnectorId` (the template installer stamps
// `appInstallationId` on every column it plants — see `template-installer.ts`), so
// `isProtectedField` refuses them unless the sweep passes `allowProtectedDeletion: true`.
// Before that fix the sweep called `deleteCustomField` bare and the delete behavior threw
// for any app connector with a stray column.
//
// The sweep used to live inline in `deleteConnector`. It now runs in
// `finalizeConnectorTeardown`, the last step of the teardown chain, because the
// record wipe ahead of it moved to the worker
// (plans/records/bulk-delete-at-scale.md §7). The sweep itself is unchanged —
// these tests drive it at its new entry point, and the last one pins the split.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `removeConnectorScheduler` (called unconditionally by `deleteConnector`) reaches BullMQ
// via `getQueue`; fake it the same way `data-connector-scheduler.test.ts` does.
const removeJobScheduler = vi.fn().mockResolvedValue(undefined)
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({ removeJobScheduler: (...a: unknown[]) => removeJobScheduler(...a) }),
  Queues: { dataConnectorQueue: 'data-connector' },
}))

const deleteCustomField = vi.fn()
const notifyCustomFieldChanged = vi.fn()
const enqueueConnectorTeardown = vi.fn(async (_arg: unknown) => {})
vi.mock('../custom-fields', () => ({
  deleteCustomField: (...args: unknown[]) => deleteCustomField(...args),
  notifyCustomFieldChanged: (...args: unknown[]) => notifyCustomFieldChanged(...args),
  toFieldError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}))

const deleteAppFields = vi.fn()
vi.mock('../custom-fields/delete-field', () => ({
  deleteAppFields: (...args: unknown[]) => deleteAppFields(...args),
}))

vi.mock('../entity-definitions', () => ({
  // A real class, not `vi.fn(() => ({...}))` — production calls `new EntityDefinitionService(...)`
  // and an arrow-returning mock fn is not constructible (see `src/test/setup.ts`'s Pusher mock
  // for the same note).
  EntityDefinitionService: class {
    delete = vi.fn()
  },
}))

vi.mock('./data-connector-queue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueConnectorTeardown: (arg: unknown) => enqueueConnectorTeardown(arg),
}))

import {
  deleteConnector,
  disconnectConnectors,
  finalizeConnectorTeardown,
  reconnectConnectorsForInstallation,
} from './mutations'

/**
 * Fluent stand-in for the handful of chained calls `deleteConnector`'s `delete` path
 * makes, keyed on whichever table each `.from()` / `.delete()` targets — `schema`'s
 * per-key memoized identity (see `src/test/setup.ts`) makes that comparison safe.
 */
function buildDb(opts: {
  connectorRow: Record<string, unknown>
  strayFields: Array<{ id: string; entityDefinitionId: string | null }>
  /** Rows the `DataConnector` select yields — the owner read, then the survivor probe. */
  dataConnectorRows?: Array<Array<Record<string, unknown>>>
  /** The soft-deleted installation the deferred sweep looks for; null ⇒ still installed. */
  uninstalledInstallation?: { id: string } | null
}) {
  let table: unknown
  let isDelete = false
  const dataConnectorReads = [...(opts.dataConnectorRows ?? [])]
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    selectDistinct: vi.fn(() => chain),
    from: vi.fn((t: unknown) => {
      table = t
      return chain
    }),
    innerJoin: vi.fn(() => chain),
    delete: vi.fn((t: unknown) => {
      table = t
      // `db.delete(DataConnector).where(...)` lands on the same `where` as the two
      // SELECTs against that table. Without this flag the delete would consume a
      // queued read and the survivor probe would silently get the wrong rows —
      // which is exactly how the "another connector survives" test first failed.
      isDelete = true
      return chain
    }),
    where: vi.fn(() => {
      if (table === schema.CustomField) return Promise.resolve(opts.strayFields)
      if (table === schema.EntityDefinition) return Promise.resolve([])
      if (table === schema.DataConnectorItem) return Promise.resolve([])
      if (table === schema.DataConnector && !isDelete) {
        // Two reads hit this table in order: the owner lookup before the row delete,
        // then the survivor probe. `.limit()` is chained off the second, and returning
        // the promise for both keeps the awaited value right either way.
        const next = dataConnectorReads.shift() ?? []
        const promise = Promise.resolve(next) as Promise<unknown> & { limit?: unknown }
        promise.limit = () => Promise.resolve(next)
        return promise
      }
      isDelete = false
      return Promise.resolve(undefined)
    }),
    limit: vi.fn(() => Promise.resolve([])),
    update: vi.fn((t: unknown) => {
      table = t
      return chain
    }),
    set: vi.fn(() => chain),
    query: {
      DataConnector: { findFirst: vi.fn().mockResolvedValue(opts.connectorRow) },
      AppInstallation: {
        findFirst: vi.fn().mockResolvedValue(opts.uninstalledInstallation ?? undefined),
      },
    },
  }
  return chain
}

beforeEach(() => {
  deleteCustomField
    .mockReset()
    .mockResolvedValue(ok({ success: true, deletedFieldIds: ['field_1'] }))
  notifyCustomFieldChanged.mockReset()
  enqueueConnectorTeardown.mockReset()
})

describe('finalizeConnectorTeardown — delete behavior stray-field sweep', () => {
  it('deletes a stray column stamped with both appInstallationId and dataConnectorId instead of refusing it', async () => {
    const db = buildDb({
      connectorRow: { id: 'dc_1', organizationId: 'org_1' },
      strayFields: [{ id: 'field_1', entityDefinitionId: 'def_1' }],
    })

    const result = await finalizeConnectorTeardown(
      db as unknown as Database,
      'org_1',
      'user_1',
      'dc_1',
      'delete'
    )

    expect(result).toEqual({ success: true })
    expect(deleteCustomField).toHaveBeenCalledTimes(1)
    expect(deleteCustomField).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1', allowProtectedDeletion: true })
    )
    expect(notifyCustomFieldChanged).toHaveBeenCalledWith('org_1', 'def_1', 'deleted')
  })

  it('touches no stray fields when none carry the connector id', async () => {
    const db = buildDb({
      connectorRow: { id: 'dc_1', organizationId: 'org_1' },
      strayFields: [],
    })

    await finalizeConnectorTeardown(db as unknown as Database, 'org_1', 'user_1', 'dc_1', 'delete')

    expect(deleteCustomField).not.toHaveBeenCalled()
  })
})

describe('deleteConnector — where the work happens', () => {
  const db = () =>
    buildDb({
      connectorRow: { id: 'dc_1', organizationId: 'org_1' },
      strayFields: [{ id: 'field_1', entityDefinitionId: 'def_1' }],
    }) as unknown as Database

  it('does the whole job inline for `keep` — no records are touched', async () => {
    const result = await deleteConnector(db(), 'org_1', 'user_1', 'dc_1', 'keep')

    expect(result).toEqual({ success: true })
    expect(enqueueConnectorTeardown).not.toHaveBeenCalled()
    // `keep` leaves the provisioned schema alone; the FK simply nulls.
    expect(deleteCustomField).not.toHaveBeenCalled()
  })

  for (const behavior of ['archive', 'delete'] as const) {
    it(`marks the connector deleting and enqueues the chain for \`${behavior}\``, async () => {
      // 🛑 The connector row must NOT be deleted here: `DataConnectorItem`
      // cascades with it and those rows ARE the record selection. Tearing it
      // down now would strand every synced record with nothing left pointing at
      // it. The row is the teardown's anchor until the last slice.
      const result = await deleteConnector(db(), 'org_1', 'user_1', 'dc_1', behavior)

      expect(result).toEqual({ success: true })
      expect(enqueueConnectorTeardown).toHaveBeenCalledWith({
        connectorId: 'dc_1',
        organizationId: 'org_1',
        userId: 'user_1',
        behavior,
      })
      // Nothing torn down synchronously — that is the slices' job.
      expect(deleteCustomField).not.toHaveBeenCalled()
    })
  }
})

// plans/money/tasks/44 D-1 — the lifecycle doors DISCONNECT a connector instead of
// deleting it, so the row (and every `DataConnectorItem` binding hanging off it)
// survives an uninstall.
describe('disconnectConnectors', () => {
  /** Captures the `.set()` payload so the test can assert what was and was NOT written. */
  function updateSpyDb() {
    const set = vi.fn((_payload: Record<string, unknown>) => ({
      where: vi.fn().mockResolvedValue(undefined),
    }))
    return { db: { update: vi.fn(() => ({ set })) }, set }
  }

  beforeEach(() => {
    removeJobScheduler.mockClear()
  })

  it('marks the rows disconnected and tears down each BullMQ scheduler', async () => {
    const { db, set } = updateSpyDb()

    const result = await disconnectConnectors(
      db as unknown as Database,
      'org_1',
      ['dc_1', 'dc_2'],
      'Shopify was uninstalled'
    )

    expect(result).toEqual({ disconnected: 2 })
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'disconnected', error: 'Shopify was uninstalled' })
    )
    // The status gate governs REGISTRATION, but an already-registered scheduler keeps
    // firing until it is removed. That ticking schedule — failing auth on every run,
    // because uninstall preserves the credential but not the app — is the original bug
    // the deleted-connector loop existed to fix, and it must stay fixed.
    //
    // FOUR calls, not two: `removeConnectorScheduler` tears down BOTH of a connector's
    // schedulers, the sync one and the delete-reconciliation sweep. Asserting the ids
    // rather than a bare count is what pins that the sweep is not forgotten — it is
    // registered independently (webhook connectors have one and no sync schedule).
    expect(removeJobScheduler.mock.calls.flat()).toEqual([
      'data-connector-sync-dc_1',
      'data-connector-sweep-dc_1',
      'data-connector-sync-dc_2',
      'data-connector-sweep-dc_2',
    ])
  })

  it('never touches syncBehavior — the cadence has to survive for a reconnect', async () => {
    const { db, set } = updateSpyDb()

    await disconnectConnectors(db as unknown as Database, 'org_1', ['dc_1'], 'gone')

    // Forcing `'manual'` would look tidy and would silently destroy the merchant's
    // schedule with nothing to restore it from. Suspension is a STATUS decision.
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty('syncBehavior')
  })

  it('short-circuits on an empty list without an UPDATE or a scheduler call', async () => {
    const { db } = updateSpyDb()

    const result = await disconnectConnectors(db as unknown as Database, 'org_1', [], 'gone')

    expect(result).toEqual({ disconnected: 0 })
    expect(db.update).not.toHaveBeenCalled()
    expect(removeJobScheduler).not.toHaveBeenCalled()
  })
})

// plans/money/tasks/44 D-1b — reinstall brings connectors back to `'paused'`, never
// straight to `'live'`.
describe('reconnectConnectorsForInstallation', () => {
  function updateSpyDb(returned: Array<{ id: string }>) {
    const where = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(returned) }))
    const set = vi.fn((_payload: Record<string, unknown>) => ({ where }))
    return { db: { update: vi.fn(() => ({ set })) }, set, where }
  }

  it('restores to paused with the error cleared — reinstalling is not consent to sync', async () => {
    const { db, set } = updateSpyDb([{ id: 'dc_1' }])

    const result = await reconnectConnectorsForInstallation(
      db as unknown as Database,
      'org_1',
      'inst_1'
    )

    expect(result).toEqual({ reconnected: 1 })
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'paused', error: null }))
    // The assertion that matters most: never `'live'`. The first run after a gap is the
    // one most likely to be large and most likely to surprise.
    expect(set.mock.calls[0]?.[0]).not.toMatchObject({ status: 'live' })
  })
})

// plans/money/tasks/44 D-2b — an installation's app-registered columns are swept when
// the connector that was part of the app is gone, NOT when the app is uninstalled.
describe('deferred app-field sweep', () => {
  const OWNER = [{ appInstallationId: 'inst_1' }]

  function teardown(opts: { uninstalled: boolean; survivors: Array<Record<string, unknown>> }) {
    return finalizeConnectorTeardown(
      buildDb({
        connectorRow: { id: 'dc_1', organizationId: 'org_1' },
        strayFields: [],
        dataConnectorRows: [OWNER, opts.survivors],
        uninstalledInstallation: opts.uninstalled ? { id: 'inst_1' } : null,
      }) as unknown as Database,
      'org_1',
      'user_1',
      'dc_1',
      'keep'
    )
  }

  beforeEach(() => {
    deleteAppFields.mockReset().mockResolvedValue(ok({ deletedFieldIds: ['f1'] }))
  })

  it('sweeps when the installation is uninstalled AND no connector survives', async () => {
    await teardown({ uninstalled: true, survivors: [] })
    expect(deleteAppFields).toHaveBeenCalledWith({ appInstallationId: 'inst_1' }, expect.anything())
  })

  it('does NOT sweep while the app is still installed — the guard that matters most', async () => {
    await teardown({ uninstalled: false, survivors: [] })
    // `writeShopifyCustomerIdField` writes the `customerId` column from an App-Proxy
    // JWT with no connector in the chain, so sweeping on connector removal alone would
    // break chat identity for an app that is still installed and still serving. This is
    // the half of the AND that is easy to drop and impossible to notice.
    expect(deleteAppFields).not.toHaveBeenCalled()
  })

  it('does NOT sweep while another connector on the installation survives', async () => {
    await teardown({ uninstalled: true, survivors: [{ id: 'dc_2' }] })
    expect(deleteAppFields).not.toHaveBeenCalled()
  })

  it('never fails the teardown when the sweep throws', async () => {
    deleteAppFields.mockRejectedValue(new Error('boom'))
    // The teardown has already done its destructive work by this point; a bookkeeping
    // failure here must leave the columns in place, not fail the whole chain.
    await expect(teardown({ uninstalled: true, survivors: [] })).resolves.toEqual({
      success: true,
    })
  })
})
