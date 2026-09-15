// packages/lib/src/money/payouts/__tests__/ingestion-owner.test.ts

import type { Database } from '@auxx/database'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { assertLegacyPayoutIngestionOwner } from '../ingestion-owner'

function fixture(owned: boolean) {
  const where = vi.fn()
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: (condition: SQL) => {
      where(new PgDialect().sqlToQuery(condition))
      return query
    },
    limit: async () => (owned ? [{ id: 'connector-1' }] : []),
  }
  const select = vi.fn(() => query)
  return { db: { select } as unknown as Database, select, where }
}

describe('source independent legacy payout ownership', () => {
  it('preserves legacy feeds with no explicit source or connection ownership claim', async () => {
    const { db, select } = fixture(true)
    await assertLegacyPayoutIngestionOwner(db, { organizationId: 'org-1', sourceId: 'stripe' })
    expect(select).not.toHaveBeenCalled()
  })
  it('permits a connection with no enabled financial target mapping', async () => {
    const { db } = fixture(false)
    await expect(
      assertLegacyPayoutIngestionOwner(db, {
        organizationId: 'org-1',
        ownership: { appInstallationId: 'app-a', credentialId: 'credential-a' },
      })
    ).resolves.toBeUndefined()
  })
  it('checks the exact reporting connection and mapped financial resource, independent of app or stream names', async () => {
    const { db, where } = fixture(true)
    await expect(
      assertLegacyPayoutIngestionOwner(db, {
        organizationId: 'org-1',
        ownership: { appInstallationId: 'app-a', credentialId: 'credential-a' },
      })
    ).rejects.toThrow('settlement posting is not enabled')
    const query = where.mock.calls[0]![0]
    expect(query.params).toEqual([
      'org-1',
      'app-a',
      'credential-a',
      true,
      'upsert',
      'payout',
      'processor_balance_entry',
    ])
    expect(query.sql).not.toContain('streamKey')
    expect(query.sql).not.toContain('status')
  })
  it('checks an explicit account without blocking another merchant or environment', async () => {
    const { db, where } = fixture(true)
    await expect(
      assertLegacyPayoutIngestionOwner(db, {
        organizationId: 'org-1',
        ownership: {
          sourceAccount: {
            providerKey: 'processor-b',
            externalAccountId: 'merchant-b',
            environment: 'test',
          },
        },
      })
    ).rejects.toThrow('financial source records')
    expect(where.mock.calls[0]![0].params).toEqual([
      'org-1',
      'processor-b',
      'merchant-b',
      'test',
      'payout',
      'balance_transaction',
    ])
  })
  it('respects the current gateway selection without changing other gateway owners', async () => {
    const { db, where } = fixture(true)
    await expect(
      assertLegacyPayoutIngestionOwner(db, {
        organizationId: 'org-1',
        rail: { id: 'gateway-b' } as never,
      })
    ).rejects.toThrow('financial source records')
    expect(where.mock.calls[0]![0].params).toEqual([
      'org-1',
      'gateway-b',
      'payment_gateway_settlement_account',
      '',
    ])
  })
})
