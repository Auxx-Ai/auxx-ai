// packages/lib/src/accounting/connect-and-go/__tests__/activate-book-connection.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  active: null as { id: string; exportFromDate: string } | null,
  providerId: 'quickbooks',
  cutoffPeriod: '2025-12' as string | null,
  credentials: [] as { id: string; label: string; companyId: string | null }[],
  activations: [] as Record<string, unknown>[],
}))

vi.mock('../../providers/book-connections', () => ({
  readActiveBookConnection: async () => h.active,
  readAccountingBookConnectionStatus: async () => ({
    activeConnectionId: h.active?.id ?? null,
    connections: [],
    credentials: h.credentials,
  }),
  activateAccountingBookConnection: async (_db: unknown, input: Record<string, unknown>) => {
    h.activations.push(input)
    return { id: 'conn_new' }
  },
}))

vi.mock('../../providers/provider', () => ({
  NONE_PROVIDER_ID: 'none',
  resolveAccountingProvider: async () => ({ id: h.providerId }),
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': h.cutoffPeriod }),
}))

import {
  activateBookConnectionForSetup,
  exportFromDateForCutoff,
} from '../activate-book-connection'
import { CONNECT_AND_GO_OPENING_REASON } from '../client'

const db = {} as Database
const base = { organizationId: 'org_1', actorUserId: 'usr_1' }

beforeEach(() => {
  h.active = null
  h.providerId = 'quickbooks'
  h.cutoffPeriod = '2025-12'
  h.credentials = [{ id: 'cred_1', label: 'Company', companyId: 'realm_1' }]
  h.activations = []
})

describe('exportFromDateForCutoff', () => {
  it.each([
    ['2025-12', '2026-01-01'],
    ['2024-02', '2024-03-01'],
    ['2026-06', '2026-07-01'],
  ])('%s -> %s', (cutoff, expected) => {
    expect(exportFromDateForCutoff(cutoff)).toBe(expected)
  })
})

describe('activateBookConnectionForSetup', () => {
  it('activates from the day after the cutover with the setup reason', async () => {
    const result = await activateBookConnectionForSetup(db, base)

    expect(result._unsafeUnwrap()).toEqual({
      activated: true,
      connectionId: 'conn_new',
      exportFromDate: '2026-01-01',
    })
    expect(h.activations).toEqual([
      {
        ...base,
        credentialId: 'cred_1',
        exportFromDate: '2026-01-01',
        expectedActiveConnectionId: null,
        openingPolicy: {
          version: 1,
          kind: 'explicit_cutover',
          exportFromDate: '2026-01-01',
          reason: CONNECT_AND_GO_OPENING_REASON,
        },
      },
    ])
  })

  it('returns the active connection untouched when one exists', async () => {
    h.active = { id: 'conn_old', exportFromDate: '2025-06-01' }

    const result = await activateBookConnectionForSetup(db, base)

    expect(result._unsafeUnwrap()).toEqual({
      activated: false,
      connectionId: 'conn_old',
      exportFromDate: '2025-06-01',
    })
    expect(h.activations).toEqual([])
  })

  it('refuses without a connected provider, a cutover, or a usable authorization', async () => {
    h.providerId = 'none'
    expect((await activateBookConnectionForSetup(db, base))._unsafeUnwrapErr().message).toMatch(
      /No accounting system is connected/
    )

    h.providerId = 'quickbooks'
    h.cutoffPeriod = ' '
    expect((await activateBookConnectionForSetup(db, base))._unsafeUnwrapErr().message).toMatch(
      /cutover month/
    )

    h.cutoffPeriod = '2025-12'
    h.credentials = [{ id: 'cred_1', label: 'Company', companyId: null }]
    expect((await activateBookConnectionForSetup(db, base))._unsafeUnwrapErr().message).toMatch(
      /no usable company authorization/
    )
    expect(h.activations).toEqual([])
  })

  it('refuses to pick between two connected companies', async () => {
    h.credentials = [
      { id: 'cred_1', label: 'A', companyId: 'realm_1' },
      { id: 'cred_2', label: 'B', companyId: 'realm_2' },
    ]

    const result = await activateBookConnectionForSetup(db, base)

    expect(result._unsafeUnwrapErr().message).toMatch(/More than one accounting company/)
    expect(h.activations).toEqual([])
  })

  it('uses either authorization when both are for the same company', async () => {
    h.credentials = [
      { id: 'cred_1', label: 'A', companyId: 'realm_1' },
      { id: 'cred_2', label: 'A again', companyId: 'realm_1' },
    ]

    expect((await activateBookConnectionForSetup(db, base)).isOk()).toBe(true)
    expect(h.activations[0]?.credentialId).toBe('cred_1')
  })
})
