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
vi.mock('../jobs/queues', () => ({
  getQueue: () => ({ removeJobScheduler: vi.fn().mockResolvedValue(undefined) }),
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

import { deleteConnector, finalizeConnectorTeardown } from './mutations'

/**
 * Fluent stand-in for the handful of chained calls `deleteConnector`'s `delete` path
 * makes, keyed on whichever table each `.from()` / `.delete()` targets — `schema`'s
 * per-key memoized identity (see `src/test/setup.ts`) makes that comparison safe.
 */
function buildDb(opts: {
  connectorRow: Record<string, unknown>
  strayFields: Array<{ id: string; entityDefinitionId: string | null }>
}) {
  let table: unknown
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
      return chain
    }),
    where: vi.fn(() => {
      if (table === schema.CustomField) return Promise.resolve(opts.strayFields)
      if (table === schema.EntityDefinition) return Promise.resolve([])
      if (table === schema.DataConnectorItem) return Promise.resolve([])
      return Promise.resolve(undefined)
    }),
    update: vi.fn((t: unknown) => {
      table = t
      return chain
    }),
    set: vi.fn(() => chain),
    query: {
      DataConnector: { findFirst: vi.fn().mockResolvedValue(opts.connectorRow) },
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
