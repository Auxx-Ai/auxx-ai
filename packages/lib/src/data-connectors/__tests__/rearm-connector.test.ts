// packages/lib/src/data-connectors/__tests__/rearm-connector.test.ts
//
// 🛑 The scheduler half is the one this pins. `disconnectConnectors` tears the BullMQ
// schedulers down, so a re-arm that only writes the status leaves a `'scheduled'`
// connector that never fires again — and nothing says so until a merchant notices the
// feed has been quiet for a week.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const syncConnectorScheduler = vi.fn(async () => {})

vi.mock('../data-connector-scheduler', () => ({
  syncConnectorScheduler,
  removeConnectorScheduler: vi.fn(async () => {}),
  SUSPENDED_CONNECTOR_STATUSES: ['paused', 'disconnected', 'deleting', 'delete_failed'],
  isSuspendedConnectorStatus: () => false,
}))

const { rearmConnector } = await import('../mutations')

function fakeDb(rows: Record<string, unknown>[]) {
  const updates: { values: Record<string, unknown> }[] = []
  const db = {
    updates,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({ returning: async () => (updates.push({ values }), rows) }),
      }),
    }),
  }
  return db as unknown as Parameters<typeof rearmConnector>[0] & typeof db
}

const ROW = { id: 'conn_1', organizationId: 'org_1', syncBehavior: 'scheduled' }

beforeEach(() => {
  syncConnectorScheduler.mockClear()
})

describe('rearmConnector', () => {
  it('moves the connector off `disconnected` and clears the error', async () => {
    const db = fakeDb([ROW])
    const row = await rearmConnector(db, 'org_1', 'conn_1')

    expect(db.updates[0]?.values).toMatchObject({ status: 'pending', error: null })
    expect(row.id).toBe('conn_1')
  })

  it('re-registers the scheduler off the row it just wrote', async () => {
    const db = fakeDb([ROW])
    await rearmConnector(db, 'org_1', 'conn_1')

    expect(syncConnectorScheduler).toHaveBeenCalledWith(ROW)
  })

  it('refuses a connector this org does not have, and registers nothing', async () => {
    const db = fakeDb([])
    await expect(rearmConnector(db, 'org_1', 'conn_1')).rejects.toThrow(/not found/i)
    expect(syncConnectorScheduler).not.toHaveBeenCalled()
  })
})
