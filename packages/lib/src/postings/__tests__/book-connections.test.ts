// packages/lib/src/postings/__tests__/book-connections.test.ts

import type { Transaction } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountingOpeningPolicySchema,
  activateAccountingBookConnectionInTx,
  quickbooksCompanyId,
  readPinnedAccountingConnectionInTx,
  resolveFulfillmentDeliveryIntentInTx,
} from '../book-connections'

vi.mock('../accounting-commit-lock', () => ({ withAccountingCommitLock: vi.fn() }))

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
    Credential: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'credential_a',
        appId: 'qb',
        appInstallationId: 'install',
        kind: 'app',
        userId: null,
        metadata: { realmId: 'realm_a' },
      }),
    },
    App: {
      findFirst: vi.fn().mockResolvedValue({ slug: 'quickbooks' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'qb' }]),
    },
    AppInstallation: { findFirst: vi.fn().mockResolvedValue({ id: 'install' }) },
    OrganizationSetting: { findFirst: vi.fn().mockResolvedValue({ value: true }) },
  }
  const tx = { query, insert: vi.fn(), update: vi.fn() }
  return { query, tx: tx as unknown as Transaction, writes: tx }
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
  it('pins automatic intent using the connection identity', async () => {
    const { tx } = fixture()
    expect(await resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).toEqual({
      kind: 'automatic',
      connectionId: 'connection_a',
    })
  })
  it('holds delivery for manual release when the existing export switch is off', async () => {
    const { tx, query } = fixture()
    query.OrganizationSetting.findFirst.mockResolvedValue({ value: false })
    expect(await resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).toEqual({
      kind: 'manual',
      connectionId: 'connection_a',
    })
  })
  it('does not replay periods before the explicit export boundary', async () => {
    const { tx } = fixture()
    expect(await resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-08-31')).toEqual({
      kind: 'not_required',
    })
  })
  it('blocks an installed legacy provider until its explicit opening choice is bridged', async () => {
    const { tx, query } = fixture()
    query.ExternalBookConnection.findFirst.mockResolvedValue(undefined)
    await expect(resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).rejects.toThrow(
      'explicit export start date'
    )
  })
  it('blocks disconnected historical books even after uninstall', async () => {
    const { tx, query } = fixture()
    query.ExternalBookConnection.findFirst.mockResolvedValue(undefined)
    query.ExternalAccountingBook.findMany.mockResolvedValue([{ id: 'book_a' }])
    query.AppInstallation.findFirst.mockResolvedValue(undefined)
    await expect(resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).rejects.toThrow()
  })
  it('allows local-only when no installation or historical accounting book exists', async () => {
    const { tx, query } = fixture()
    query.ExternalBookConnection.findFirst.mockResolvedValue(undefined)
    query.AppInstallation.findFirst.mockResolvedValue(undefined)
    expect(await resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).toEqual({
      kind: 'not_required',
    })
  })
  it('does not turn authoritative read failures into local-only intent', async () => {
    const { tx, query } = fixture()
    query.ExternalBookConnection.findFirst.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveFulfillmentDeliveryIntentInTx(tx, 'org', '2026-09-12')).rejects.toThrow(
      'database unavailable'
    )
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
    const { tx, query } = fixture()
    query.Credential.findFirst.mockResolvedValue({
      id: 'credential_a',
      appId: 'qb',
      appInstallationId: 'install',
      kind: 'app',
      userId: 'user',
      metadata: { realmId: 'realm_a' },
    })
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
