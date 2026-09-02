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

const deleteConnector = vi.fn()
vi.mock('../../../data-connectors/mutations', () => ({
  deleteConnector: (...args: unknown[]) => deleteConnector(...args),
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
  deleteConnector.mockReset().mockResolvedValue({ success: true })
  getSystemUser.mockReset().mockResolvedValue('system_user_1')
  triggerAppEvent.mockReset().mockResolvedValue(ok(undefined))
  vi.mocked(database.select).mockReset()
})

describe('deleteAppConnection — connector cleanup', () => {
  it('deletes every DataConnector backed by the credential, behavior keep, before deleting the credential', async () => {
    const order: string[] = []
    vi.mocked(database.select).mockImplementation(() => {
      order.push('select-connectors')
      return chain([{ id: 'dc_1' }]) as never
    })
    deleteConnector.mockImplementation(async () => {
      order.push('delete-connector')
      return { success: true }
    })
    deleteCredential.mockImplementation(async () => {
      order.push('delete-credential')
      return ok(undefined)
    })

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isOk()).toBe(true)
    expect(deleteConnector).toHaveBeenCalledWith(database, 'org_1', 'system_user_1', 'dc_1', 'keep')
    expect(order).toEqual(['select-connectors', 'delete-connector', 'delete-credential'])
  })

  it('skips the system-user lookup and deleteConnector when the credential backs no connector', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([]) as never)

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isOk()).toBe(true)
    expect(deleteConnector).not.toHaveBeenCalled()
    expect(getSystemUser).not.toHaveBeenCalled()
    expect(deleteCredential).toHaveBeenCalledWith('cred_1', 'org_1')
  })

  it('returns an error Result instead of throwing when deleteConnector fails, and never deletes the credential', async () => {
    vi.mocked(database.select).mockImplementation(() => chain([{ id: 'dc_1' }]) as never)
    deleteConnector.mockRejectedValue(new Error('connector not found'))

    const result = await deleteAppConnection('cred_1', 'org_1')

    expect(result.isErr()).toBe(true)
    expect(deleteCredential).not.toHaveBeenCalled()
  })
})
