// packages/lib/src/organizations/__tests__/delete-organization-fc-release.test.ts
//
// plans/bank-connection/08-removing-a-bank-account.md §5.4 door 4 / §7.6.
//
// 🛑 Stripe bills 30c per institution per account holder per month and the ONLY thing
// that stops it is calling disconnect on the account. `DataConnector.organizationId` is
// `onDelete: 'cascade'`, so deleting an organization takes its connectors with it and
// the nightly reaper can never find them afterwards - the delete destroys the evidence
// in the same transaction that would otherwise create the leak. So the release has to
// happen BEFORE the transaction, and these tests pin both halves of that: that it
// happens, and that a failure does not take the deletion down with it.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Every call the ordering assertion cares about, in the order production made it. */
const trace: string[] = []

const listBankFeedAccountsForOrganization = vi.fn(async (_db: unknown, _orgId: string) => [
  {
    connectorId: 'conn_1',
    organizationId: 'org_1',
    credentialId: 'cred_1',
    providerAccountId: 'fca_1',
  },
  {
    connectorId: 'conn_2',
    organizationId: 'org_1',
    credentialId: 'cred_2',
    providerAccountId: 'fca_2',
  },
])
const reapBankFeedAccount = vi.fn(async (_db: unknown, candidate: { connectorId: string }) => {
  trace.push(`release:${candidate.connectorId}`)
  return true
})

/** The plan-subscription cancel. `subscriptionCancel` is swapped per test. */
let subscriptionCancel = vi.fn(async () => {
  trace.push('subscription-cancel')
})

vi.mock('@auxx/billing', () => ({
  stripeClient: {
    getClient: () => ({
      subscriptions: {
        retrieve: async () => ({ id: 'sub_1', status: 'active' }),
        cancel: (...a: []) => subscriptionCancel(...a),
      },
    }),
  },
}))

vi.mock('../../banking/feed/reaper', () => ({
  listBankFeedAccountsForOrganization: (...a: [never, never]) =>
    listBankFeedAccountsForOrganization(...a),
  reapBankFeedAccount: (...a: [never, never]) => reapBankFeedAccount(...a),
}))

// Everything below is module-load ballast for `organization-service.ts`: Redis, BullMQ,
// Pusher and the seeder. None of it participates in the release path.
vi.mock('../../cache', () => ({
  flushOrganization: vi.fn(async () => {}),
  onCacheEvent: vi.fn(async () => {}),
}))
vi.mock('../../dehydration', () => ({
  DehydrationService: class {
    invalidateUser = vi.fn(async () => {})
  },
}))
vi.mock('../../email/message-service', () => ({
  MessageService: { unregisterWebhooks: vi.fn(async () => {}) },
}))
vi.mock('../../email/polling-import-cache', () => ({ clearImportCache: vi.fn(async () => {}) }))
vi.mock('../../inboxes', () => ({ InboxService: class {} }))
vi.mock('../../jobs/maintenance/storage-cleanup-job', () => ({
  enqueueStorageCleanupJob: vi.fn(async () => {}),
}))
vi.mock('../../members', () => ({ getMembership: vi.fn(async () => null) }))
vi.mock('../../permissions/profiles', () => ({ ensureSystemProfiles: vi.fn(async () => {}) }))
vi.mock('../../seed/organization-seeder', () => ({ OrganizationSeeder: class {} }))
vi.mock('../../users/system-user-service', () => ({
  SystemUserService: { invalidateSystemUserCache: vi.fn(async () => {}) },
}))

const { OrganizationService } = await import('../organization-service')

/**
 * A db double for the pre-transaction reads `deleteOrganization` makes, in order:
 * the owner count, the member list, and the organization's system user.
 *
 * ⚠️ The WHERE clauses are never evaluated. What these tests pin is the ORDERING of
 * the Stripe release against the transaction, not the SQL.
 */
function fakeDb() {
  const selectResults: unknown[][] = [[{ count: 1 }], [], [{ systemUserId: null }]]

  const selectChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => {
        const rows = selectResults.shift() ?? []
        const promise = Promise.resolve(rows) as Promise<unknown> & { limit?: unknown }
        promise.limit = () => Promise.resolve(rows)
        return promise
      },
      limit: () => Promise.resolve([]),
    }
    return chain
  }

  const writable = {
    select: () => selectChain(),
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }

  return {
    ...writable,
    query: { PlanSubscription: { findFirst: async () => undefined } },
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      trace.push('transaction')
      // Inside the transaction the integration read must yield an empty list; queue it
      // here rather than up front so a missed pre-transaction read cannot borrow it.
      selectResults.push([])
      await cb(writable)
    },
  }
}

/** The db double covers only the calls this path makes, so the cast is deliberate. */
const asDb = (db: unknown) => db as Database

beforeEach(() => {
  trace.length = 0
  reapBankFeedAccount.mockClear()
  reapBankFeedAccount.mockImplementation(async (_db, candidate) => {
    trace.push(`release:${candidate.connectorId}`)
    return true
  })
  listBankFeedAccountsForOrganization.mockClear()
  subscriptionCancel = vi.fn(async () => {
    trace.push('subscription-cancel')
  })
})

/** A db double whose org carries an active plan subscription, so the cancel runs. */
function dbWithSubscription() {
  const db = fakeDb()
  return {
    ...db,
    query: {
      PlanSubscription: {
        findFirst: async () => ({
          id: 'psub_1',
          stripeSubscriptionId: 'sub_1',
          status: 'active',
        }),
      },
    },
  }
}

describe('deleteOrganization releases Financial Connections accounts', () => {
  it('releases every account the org holds, BEFORE the transaction', async () => {
    const service = new OrganizationService(asDb(fakeDb()))

    const result = await service.deleteOrganization({
      organizationId: 'org_1',
      isSystemDeletion: true,
    })

    expect(result).toEqual({ success: true, userDeleted: false })
    expect(reapBankFeedAccount).toHaveBeenCalledTimes(2)
    // 🛑 The ordering IS the fix. Once the transaction commits, the connectors have
    // cascaded away and there is no `providerAccountId` left to disconnect - not here,
    // and not in the nightly sweep either.
    expect(trace).toEqual(['release:conn_1', 'release:conn_2', 'transaction'])
  })

  it('completes the deletion when a release throws', async () => {
    reapBankFeedAccount.mockImplementation(async (_db, candidate) => {
      trace.push(`release:${candidate.connectorId}`)
      if (candidate.connectorId === 'conn_1') throw new Error('stripe is down')
      return true
    })
    const service = new OrganizationService(asDb(fakeDb()))

    // The opposite tradeoff from the plan-subscription cancel that sits beside this
    // block, and deliberately so: a leaked 30c is recoverable by a human reading an
    // invoice, an organization that can never be deleted is not.
    const result = await service.deleteOrganization({
      organizationId: 'org_1',
      isSystemDeletion: true,
    })

    expect(result).toEqual({ success: true, userDeleted: false })
    // And the throw does not stop the SECOND account being released either.
    expect(trace).toEqual(['release:conn_1', 'release:conn_2', 'transaction'])
  })

  it('releases AFTER the plan-subscription cancel, not before it', async () => {
    const service = new OrganizationService(asDb(dbWithSubscription()))

    await service.deleteOrganization({ organizationId: 'org_1', isSystemDeletion: true })

    // 🛑 Both steps run before the transaction, but the ORDER between them matters and
    // is not arbitrary. See the next test for what it buys.
    expect(trace).toEqual([
      'subscription-cancel',
      'release:conn_1',
      'release:conn_2',
      'transaction',
    ])
  })

  it('releases NOTHING when the subscription cancel aborts the deletion', async () => {
    subscriptionCancel = vi.fn(async () => {
      trace.push('subscription-cancel')
      throw new Error('stripe rejected the cancel')
    })
    const service = new OrganizationService(asDb(dbWithSubscription()))

    await expect(
      service.deleteOrganization({ organizationId: 'org_1', isSystemDeletion: true })
    ).rejects.toThrow()

    // 🛑 This is why the release sits BELOW the cancel. The cancel is the one step here
    // that throws and aborts the delete, and it is the one with a history of doing so.
    // Releasing first would leave a SURVIVING organization whose bank feeds had already
    // been released at Stripe - recoverable only by the customer authenticating at their
    // bank again, which is a far worse outcome than the leaked 30c the release prevents.
    expect(reapBankFeedAccount).not.toHaveBeenCalled()
    expect(trace).toEqual(['subscription-cancel'])
  })

  it('completes the deletion when the account lookup itself throws', async () => {
    listBankFeedAccountsForOrganization.mockRejectedValueOnce(new Error('no db'))
    const service = new OrganizationService(asDb(fakeDb()))

    const result = await service.deleteOrganization({
      organizationId: 'org_1',
      isSystemDeletion: true,
    })

    expect(result).toEqual({ success: true, userDeleted: false })
    expect(reapBankFeedAccount).not.toHaveBeenCalled()
    expect(trace).toEqual(['transaction'])
  })
})
