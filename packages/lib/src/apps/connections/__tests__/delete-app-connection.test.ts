// packages/lib/src/apps/connections/__tests__/delete-app-connection.test.ts
// Disconnect's connector cleanup (app-fields-and-entities plan §4.4 fix 1): every
// DataConnector backed by the credential being disconnected must be deleted, behavior
// 'keep', BEFORE the credential itself is deleted. `deleteConnector` is otherwise only
// reachable from the tRPC router: before this fix a disconnect left the connector's
// mappings pointed at a dead credential, its BullMQ schedule still ticking, and its
// `credentialId` FK merely nulled by the credential delete (row survives).

import { database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revealSecrets = vi.fn()
const deleteCredential = vi.fn()
vi.mock('@auxx/credentials/store', () => ({
  revealSecrets: (...args: unknown[]) => revealSecrets(...args),
  deleteCredential: (...args: unknown[]) => deleteCredential(...args),
}))

vi.mock('@auxx/services/app-connections', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  safeSerializeMetadata: (m: unknown) => m,
}))

const disconnectConnectors = vi.fn()
vi.mock('../../../data-connectors/mutations', () => ({
  disconnectConnectors: (...args: unknown[]) => disconnectConnectors(...args),
}))

const getSystemUser = vi.fn()
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({ get: (...args: unknown[]) => getSystemUser(...args) }),
}))

const triggerAppEvent = vi.fn()
vi.mock('../../events', () => ({
  triggerAppEvent: (...args: unknown[]) => triggerAppEvent(...args),
}))

import { deleteAppConnection } from '../delete-app-connection'

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

const CONNECTION = {
  record: {
    id: 'cred_1',
    // No event trigger needed for these tests — kept out of scope.
    appInstallationId: null,
    metadata: {},
  },
  secrets: {},
}

beforeEach(() => {
  revealSecrets.mockReset().mockResolvedValue(ok(CONNECTION))
  deleteCredential.mockReset().mockResolvedValue(ok(undefined))
  disconnectConnectors.mockReset().mockResolvedValue({ disconnected: 0 })
  getSystemUser.mockReset().mockResolvedValue('system_user_1')
  triggerAppEvent.mockReset().mockResolvedValue(ok(undefined))
  vi.mocked(database.select).mockReset()
})

describe('deleteAppConnection — connector cleanup', () => {
  // INVERTED by plans/money/tasks/44 D-1. This block used to pin
  // `deleteConnector(…, 'keep')`, which destroyed the connector row and its
  // `DataConnectorItem` bindings. Disconnect and uninstall must move in lockstep or
  // disconnect quietly becomes the new silent delete.
  it('DISCONNECTS every DataConnector backed by the credential, before deleting the credential', async () => {
    const order: string[] = []
    vi.mocked(database.select).mockImplementation(() => {
      order.push('select-connectors')
      return chain([{ id: 'dc_1' }]) as never
    })
    disconnectConnectors.mockImplementation(async () => {
      order.push('disconnect-connectors')
      return { disconnected: 1 }
    })
    deleteCredential.mockImplementation(async () => {
      order.push('delete-credential')
      return ok(undefined)
    })

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isOk()).toBe(true)
    expect(disconnectConnectors).toHaveBeenCalledWith(
      database,
      'org_1',
      ['dc_1'],
      expect.any(String)
    )
    // Ordering is the load-bearing half: the credential must still be alive when the
    // connectors are marked, or a failure leaves them pointed at a row that is gone.
    expect(order).toEqual(['select-connectors', 'disconnect-connectors', 'delete-credential'])
  })

  it('passes an empty list when the credential backs no connector, and still deletes it', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([]) as never)

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isOk()).toBe(true)
    expect(disconnectConnectors).toHaveBeenCalledWith(database, 'org_1', [], expect.any(String))
    expect(deleteCredential).toHaveBeenCalledWith('cred_1', 'org_1')
  })

  it('returns an error Result instead of throwing when the disconnect fails, and never deletes the credential', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([{ id: 'dc_1' }]) as never)
    disconnectConnectors.mockRejectedValue(new Error('connector not found'))

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isErr()).toBe(true)
    expect(deleteCredential).not.toHaveBeenCalled()
  })
})
