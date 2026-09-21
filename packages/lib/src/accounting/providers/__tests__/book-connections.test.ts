// packages/lib/src/accounting/providers/__tests__/book-connections.test.ts

import { schema, type Transaction } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountingOpeningPolicySchema,
  activateAccountingBookConnectionInTx,
  quickbooksCompanyId,
  readPinnedAccountingConnectionInTx,
} from '../book-connections'

vi.mock('../../ledger/post/accounting-commit-lock', () => ({ withAccountingCommitLock: vi.fn() }))
vi.mock('../../../cache', () => ({ getCachedInstalledApps: vi.fn() }))

import { getCachedInstalledApps } from '../../../cache'

/** The install probe now answers from the org cache, not `App` + `AppInstallation` reads. */
function installed(value: boolean) {
  vi.mocked(getCachedInstalledApps).mockResolvedValue(
    value
      ? ([{ app: { slug: 'quickbooks' } }] as unknown as Awaited<
          ReturnType<typeof getCachedInstalledApps>
        >)
      : []
  )
}

const policy = {
  version: 1 as const,
  kind: 'explicit_cutover' as const,
  exportFromDate: '2026-09-01',
  reason: 'Opening balances reviewed',
}
const active = {
  id: 'connection_a',
  organizationId: 'org',
  bookId: 'book_a',
  credentialId: 'credential_a',
  state: 'active',
  exportFromDate: '2026-09-01',
  openingPolicy: policy,
}
/** The joined credential row `readAppCredential` selects in one round trip. */
const credentialRow = {
  id: 'credential_a',
  appId: 'qb',
  kind: 'app',
  userId: null,
  metadata: { realmId: 'realm_a' },
  appSlug: 'quickbooks',
  appInstallationId: 'install',
  label: null,
  name: 'Fixture authorization',
}
function fixture() {
  const query = {
    ExternalBookConnection: { findFirst: vi.fn().mockResolvedValue(active) },
    ExternalAccountingBook: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'book_a',
        providerKey: 'quickbooks',
        externalCompanyId: 'realm_a',
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  }
  // Rows returned by the builder chain, keyed by the table `.from()` names —
  // both remaining `select()` reads (the credential join and the export switch
  // `getOrganizationSetting` reads through `tx`) end in `.limit(1)`.
  const rows: Record<string, unknown[]> = {
    Credential: [credentialRow],
    ExternalBookConnection: [active],
    OrganizationSetting: [{ key: 'quickbooks.postJournalEntries', value: true }],
  }
  const tables = new Map<unknown, string>([
    [schema.Credential, 'Credential'],
    [schema.ExternalBookConnection, 'ExternalBookConnection'],
    [schema.OrganizationSetting, 'OrganizationSetting'],
  ])
  const select = vi.fn(() => {
    let table = ''
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        table = tables.get(t) ?? ''
        return chain
      },
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows[table] ?? [],
    }
    return chain
  })
  const tx = { query, select, insert: vi.fn(), update: vi.fn() }
  installed(true)
  return { query, rows, tx: tx as unknown as Transaction, writes: tx }
}

beforeEach(() => vi.clearAllMocks())

describe('accounting connection bridge', () => {
  it('requires an explicit real export date and opening reason', () => {
    expect(accountingOpeningPolicySchema.safeParse(policy).success).toBe(true)
    expect(
      accountingOpeningPolicySchema.safeParse({ ...policy, exportFromDate: '2026-02-30' }).success
    ).toBe(false)
    expect(accountingOpeningPolicySchema.safeParse({ ...policy, reason: ' ' }).success).toBe(false)
    expect(
      accountingOpeningPolicySchema.safeParse({ version: 1, cutoffPeriod: '2026-08' }).success
    ).toBe(false)
  })
  it('does not fabricate a missing company identity', () => {
    for (const metadata of [null, {}, { realmId: 123 }, { realmId: ' ' }])
      expect(() => quickbooksCompanyId(metadata)).toThrow()
    expect(quickbooksCompanyId({ realmId: 'realm_a' })).toBe('realm_a')
  })
  it('refuses credentials for a different company before delivery', async () => {
    const { tx, query } = fixture()
    query.ExternalAccountingBook.findFirst.mockResolvedValue({
      id: 'book_a',
      providerKey: 'quickbooks',
      externalCompanyId: 'realm_b',
    })
    await expect(readPinnedAccountingConnectionInTx(tx, 'org', 'connection_a')).rejects.toThrow(
      'no longer identifies'
    )
  })
  it('refuses user-scoped credentials rather than falling back to a user', async () => {
    const { tx, rows } = fixture()
    rows.Credential = [{ ...credentialRow, userId: 'user' }]
    await expect(readPinnedAccountingConnectionInTx(tx, 'org', 'connection_a')).rejects.toThrow(
      'organization QuickBooks'
    )
  })
  it('exact activation retry reuses the epoch and performs no writes', async () => {
    const { tx, writes } = fixture()
    const result = await activateAccountingBookConnectionInTx(tx, {
      organizationId: 'org',
      credentialId: 'credential_a',
      exportFromDate: policy.exportFromDate,
      openingPolicy: policy,
      actorUserId: 'user',
      expectedActiveConnectionId: null,
    })
    expect(result.id).toBe('connection_a')
    expect(writes.insert).not.toHaveBeenCalled()
    expect(writes.update).not.toHaveBeenCalled()
  })
  it('concurrent destination change refuses before retiring any connection', async () => {
    const { tx, writes } = fixture()
    await expect(
      activateAccountingBookConnectionInTx(tx, {
        organizationId: 'org',
        credentialId: 'credential_a',
        exportFromDate: '2026-10-01',
        openingPolicy: { ...policy, exportFromDate: '2026-10-01' },
        actorUserId: 'user',
        expectedActiveConnectionId: null,
      })
    ).rejects.toThrow('active accounting connection changed')
    expect(writes.update).not.toHaveBeenCalled()
  })
})
