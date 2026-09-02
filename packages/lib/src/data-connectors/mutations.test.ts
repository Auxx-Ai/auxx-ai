// packages/lib/src/data-connectors/mutations.test.ts
// deleteConnector's `delete` behavior stray-field sweep (app-fields-and-entities plan
// §4.4, fix 2): an app connector's contributing columns on a SHARED def carry
// `appInstallationId` alongside `dataConnectorId` (the template installer stamps
// `appInstallationId` on every column it plants — see `template-installer.ts`), so
// `isProtectedField` refuses them unless the sweep passes `allowProtectedDeletion: true`.
// Before that fix the sweep called `deleteCustomField` bare and the delete behavior threw
// for any app connector with a stray column.

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

import { deleteConnector } from './mutations'

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
})

describe('deleteConnector — delete behavior stray-field sweep', () => {
  it('deletes a stray column stamped with both appInstallationId and dataConnectorId instead of refusing it', async () => {
    const db = buildDb({
      connectorRow: { id: 'dc_1', organizationId: 'org_1' },
      strayFields: [{ id: 'field_1', entityDefinitionId: 'def_1' }],
    })

    const result = await deleteConnector(
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

    await deleteConnector(db as unknown as Database, 'org_1', 'user_1', 'dc_1', 'delete')

    expect(deleteCustomField).not.toHaveBeenCalled()
  })
})
