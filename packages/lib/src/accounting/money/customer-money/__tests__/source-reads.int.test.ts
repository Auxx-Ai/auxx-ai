// packages/lib/src/accounting/money/customer-money/__tests__/source-reads.int.test.ts
//
// The tie (LIB-READS §0.1 bug 4): a batch write stamps one `new Date()` across
// every observation it inserts, so two rows can share an `observedAt` exactly.
// Ordering on that column alone picks one at random.

import { schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { readCurrentObservations } from '../source-reads'

let organizationId: string

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  const db = getTestDb()
  await db.insert(schema.FinancialSourceAccount).values({
    id: 'fsa_1',
    organizationId,
    providerKey: 'shopify',
    externalAccountId: 'demo.myshopify.com',
    environment: 'live',
  })
  await db.insert(schema.FinancialSourceObject).values({
    id: 'fo_1',
    organizationId,
    sourceAccountId: 'fsa_1',
    objectType: 'order_transaction',
    externalId: 'txn_1',
    componentKey: '',
  })
})

describe('readCurrentObservations', () => {
  it('breaks a same-instant tie on the id, deterministically', async () => {
    const db = getTestDb()
    const observedAt = new Date('2026-09-15T01:00:00.000Z')
    await db.insert(schema.FinancialSourceObservation).values([
      {
        id: 'ob_a',
        organizationId,
        sourceObjectId: 'fo_1',
        contentHash: 'a'.repeat(64),
        observedAt,
        payload: { n: 1 },
        reportingInstallationSnapshot: {},
      },
      {
        id: 'ob_b',
        organizationId,
        sourceObjectId: 'fo_1',
        contentHash: 'b'.repeat(64),
        observedAt,
        payload: { n: 2 },
        reportingInstallationSnapshot: {},
      },
    ])
    const map = await readCurrentObservations(db, organizationId, ['fo_1'])
    expect(map.size).toBe(1)
    expect(map.get('fo_1')?.id).toBe('ob_b')
  })

  it('prefers a later `observedAt` over a higher id', async () => {
    const db = getTestDb()
    await db.insert(schema.FinancialSourceObservation).values([
      {
        id: 'ob_z',
        organizationId,
        sourceObjectId: 'fo_1',
        contentHash: 'a'.repeat(64),
        observedAt: new Date('2026-09-15T01:00:00.000Z'),
        payload: { n: 1 },
        reportingInstallationSnapshot: {},
      },
      {
        id: 'ob_a',
        organizationId,
        sourceObjectId: 'fo_1',
        contentHash: 'b'.repeat(64),
        observedAt: new Date('2026-09-15T02:00:00.000Z'),
        payload: { n: 2 },
        reportingInstallationSnapshot: {},
      },
    ])
    const map = await readCurrentObservations(db, organizationId, ['fo_1'])
    expect(map.get('fo_1')?.id).toBe('ob_a')
  })
})
