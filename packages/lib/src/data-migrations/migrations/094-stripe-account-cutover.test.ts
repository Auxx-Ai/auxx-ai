// packages/lib/src/data-migrations/migrations/094-stripe-account-cutover.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_DATA_MIGRATIONS } from '../registry'
import { migration094StripeAccountCutover as migration } from './094-stripe-account-cutover'

/**
 * The four carve-outs from the cancel step are the whole risk surface of this migration —
 * getting one wrong downgrades a live org. Three of them (`adminOverrideAt`, `Plan.isFree`,
 * the `planId IS NULL` name fallback) are decided in TypeScript over the snapshot the
 * migration reads, so they are testable without Postgres by handing `run` a fake `db` that
 * returns exactly one row and asking whether the cancel UPDATE was issued at all.
 *
 * The fourth (Shopify) lives in the SQL `WHERE` and is only pinned here structurally; it is
 * exercised for real, alongside idempotency and entitlement preservation, in
 * `094-stripe-account-cutover.int.test.ts`.
 */

const { invalidateAndRecompute } = vi.hoisted(() => ({ invalidateAndRecompute: vi.fn() }))

vi.mock('../../cache', async (importOriginal) => {
  // Partial — `registry.ts` pulls in ninety-odd migrations, plenty of which reach into this
  // barrel for something other than `getOrgCache`. A wholesale replacement dies at collection.
  const actual = await importOriginal<typeof import('../../cache')>()
  return { ...actual, getOrgCache: () => ({ invalidateAndRecompute }) }
})

/** One row of the snapshot the migration takes before it nulls anything. */
type LinkedRow = {
  id: string
  organizationId: string
  status: string
  planName: string
  isFree: boolean | null
  adminOverrideAt: Date | null
  hasTrialEnded: boolean
}

function linkedRow(overrides: Partial<LinkedRow> = {}): LinkedRow {
  return {
    id: 'sub_1',
    organizationId: 'org_1',
    status: 'trialing',
    planName: 'starter',
    isFree: false,
    adminOverrideAt: null,
    hasTrialEnded: false,
    ...overrides,
  }
}

/**
 * Minimal stand-in for the three builder shapes `run` uses: one
 * `select().from().leftJoin().where()` read, and `update().set().where()` writes (one of
 * which also calls `.returning()`). Every `set()` payload is captured, which is all the
 * classification assertions need — with a single row in the snapshot, "a cancel UPDATE was
 * issued" and "this row was classified as terminate" are the same statement.
 */
function fakeDb(rows: LinkedRow[]) {
  const setPayloads: Record<string, unknown>[] = []
  let transactions = 0

  const db: Record<string, unknown> = {
    // Steps 1–4 run inside `db.transaction`, so the fake has to supply one. It hands the
    // same builder back as the `tx` handle, which is what makes every write below land in
    // `setPayloads` regardless of whether `run` reaches for `db` or `tx`.
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions++
      return cb(db)
    },
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setPayloads.push(values)
        // A real promise with `.returning()` bolted on: the unlink/cancel writes are
        // awaited directly, the Plan clear goes through `.returning()` first.
        const awaited = Object.assign(Promise.resolve(undefined), {
          returning: () => Promise.resolve([]),
        })
        return { where: () => awaited }
      },
    }),
  }

  return {
    db: db as unknown as Database,
    setPayloads,
    /** How many times `run` opened a transaction — the unlink and cancel must share one. */
    transactionCount: () => transactions,
    /** The cancel write from step 4, if the row was classified as terminate. */
    cancelWrite: () => setPayloads.find((payload) => payload.status === 'canceled'),
    /** The step-3 unlink, which every in-scope row gets regardless of classification. */
    unlinkWrite: () =>
      setPayloads.find(
        (payload) => 'stripeCustomerId' in payload && !('stripeProductId' in payload)
      ),
  }
}

describe('migration094StripeAccountCutover', () => {
  beforeEach(() => {
    invalidateAndRecompute.mockReset().mockResolvedValue(undefined)
  })

  describe('registry contract', () => {
    it('is registered with the id its filename claims', () => {
      expect(migration.id).toBe('094-stripe-account-cutover')
    })

    it('is registered exactly once', () => {
      expect(ALL_DATA_MIGRATIONS.filter((m) => m.id === migration.id)).toHaveLength(1)
    })
  })

  describe('atomicity', () => {
    // The snapshot-before-nulling that makes this migration idempotent also destroys its
    // recovery path: once the pointers are null, a re-run selects nothing. So an unlink that
    // committed without its cancel could never be repaired by re-running, and would strand
    // rows in the exact `trialing` + `hasTrialEnded = false` + no-subscription state the
    // trial-email and org-deletion jobs act on. One transaction makes that unrepresentable.
    it('performs every write inside a single transaction', async () => {
      const harness = fakeDb([linkedRow({ status: 'trialing' })])

      await migration.run(harness.db)

      expect(harness.transactionCount()).toBe(1)
      // Plan clear, unlink and cancel — all three writes, all inside that one transaction.
      expect(harness.setPayloads).toHaveLength(3)
      expect(harness.unlinkWrite()).toBeDefined()
      expect(harness.cancelWrite()).toBeDefined()
    })
  })

  describe('which rows get closed out', () => {
    it.each(['trialing', 'past_due', 'incomplete'])('cancels a paid %s row', async (status) => {
      const harness = fakeDb([linkedRow({ status })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeDefined()
    })

    it.each([
      'active',
      'unpaid',
      'incomplete_expired',
      'canceled',
      'paused',
    ])('unlinks but does not cancel a %s row', async (status) => {
      // `active` is the load-bearing one: the legacy account never took a payment, so a
      // paid active row means the audit was wrong — leave it for a human rather than
      // silently downgrading someone who might be paying.
      const harness = fakeDb([linkedRow({ status })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeUndefined()
      expect(harness.unlinkWrite()).toBeDefined()
    })

    it('does not cancel a row whose joined plan is free', async () => {
      // Entitlement on Free is ours; the org only ever had a $0 subscription because the
      // seeder mints Stripe products for free plans. Named `starter` on purpose, so this
      // can only pass by reading `Plan.isFree` off the LEFT JOIN.
      const harness = fakeDb([linkedRow({ isFree: true, planName: 'starter' })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeUndefined()
      expect(harness.unlinkWrite()).toBeDefined()
    })

    it.each([
      'free',
      'Free',
      'DEMO',
      'demo',
    ])('falls back to the plan name %s when the join produced no isFree', async (planName) => {
      const harness = fakeDb([linkedRow({ isFree: null, planName })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeUndefined()
    })

    it('still cancels an unjoined row whose plan name is not a free-plan name', async () => {
      // The fallback must not swallow every orphaned row — only free/demo.
      const harness = fakeDb([linkedRow({ isFree: null, planName: 'growth' })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeDefined()
    })

    it('lets a joined isFree=false override a free-sounding plan name', async () => {
      // `??` means the join wins whenever it produced a value; the name is a fallback,
      // not a veto.
      const harness = fakeDb([linkedRow({ isFree: false, planName: 'free' })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeDefined()
    })

    it('does not cancel a row under admin override', async () => {
      // A super admin owns that row's lifecycle — the same rule `subscription-updated.ts`
      // enforces against the Stripe webhook.
      const harness = fakeDb([linkedRow({ adminOverrideAt: new Date('2026-01-15') })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeUndefined()
      expect(harness.unlinkWrite()).toBeDefined()
    })
  })

  describe('what the cancel write sets', () => {
    it('closes the row out and clears every dangling schedule', async () => {
      const harness = fakeDb([linkedRow({ status: 'trialing' })])

      await migration.run(harness.db)

      const cancel = harness.cancelWrite()
      expect(cancel).toMatchObject({
        status: 'canceled',
        cancelAtPeriodEnd: false,
        // trial-conversion-job and mid-trial-job both gate on `hasTrialEnded = false`;
        // unlinking alone would make every legacy trial row newly eligible and fire real
        // emails at the bot addresses that created them.
        hasTrialEnded: true,
        scheduledPlanId: null,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledSeats: null,
        scheduledChangeAt: null,
      })
      expect(cancel?.canceledAt).toBeInstanceOf(Date)
      expect(cancel?.endDate).toBeInstanceOf(Date)
    })

    it('leaves trialConversionStatus alone', async () => {
      // `expired-trial-account-cleanup-job` matches EXPIRED_WITHOUT_CONVERSION /
      // CANCELED_DURING_TRIAL and deletes the org 14 days later. Writing either value here
      // would arm org deletion as a side effect of a pointer cleanup.
      const harness = fakeDb([linkedRow({ status: 'trialing' })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).not.toHaveProperty('trialConversionStatus')
    })

    it('never writes entitlement on the unlink', async () => {
      const harness = fakeDb([linkedRow({ status: 'active' })])

      await migration.run(harness.db)

      expect(harness.unlinkWrite()).toEqual({ stripeCustomerId: null, stripeSubscriptionId: null })
    })
  })

  describe('plan pointers', () => {
    it('nulls all three Stripe columns on Plan', async () => {
      const harness = fakeDb([])

      await migration.run(harness.db)

      expect(harness.setPayloads[0]).toMatchObject({
        stripeProductId: null,
        stripePriceIdMonthly: null,
        stripePriceIdAnnual: null,
      })
    })

    it('clears plans even when no subscription is linked', async () => {
      const harness = fakeDb([])

      await migration.run(harness.db)

      expect(harness.setPayloads).toHaveLength(1)
      expect(invalidateAndRecompute).not.toHaveBeenCalled()
    })
  })

  describe('org cache', () => {
    it('recomputes subscription and features once per distinct affected org', async () => {
      const harness = fakeDb([
        linkedRow({ id: 'sub_1', organizationId: 'org_a' }),
        linkedRow({ id: 'sub_2', organizationId: 'org_a' }),
        linkedRow({ id: 'sub_3', organizationId: 'org_b', status: 'active' }),
      ])

      await migration.run(harness.db)

      expect(invalidateAndRecompute.mock.calls).toEqual([
        ['org_a', ['subscription', 'features']],
        ['org_b', ['subscription', 'features']],
      ])
    })

    it('invalidates the org of a row it only unlinked, not just the ones it canceled', async () => {
      // `CachedSubscription` carries `stripeCustomerId`/`stripeSubscriptionId` verbatim, so
      // an unlink alone already makes the cached blob wrong.
      const harness = fakeDb([linkedRow({ organizationId: 'org_free', isFree: true })])

      await migration.run(harness.db)

      expect(harness.cancelWrite()).toBeUndefined()
      expect(invalidateAndRecompute).toHaveBeenCalledWith('org_free', ['subscription', 'features'])
    })
  })

  describe('scope, pinned structurally', () => {
    const source = migration.run.toString()

    /**
     * Shopify rows have their own lifecycle (`shopify-billing-sync-job`,
     * `shopify-seat-usage-job`) and the seeder can leave stray `stripe*` ids on them, which
     * is why the scope is `billingProvider`-explicit rather than inferred from which columns
     * happen to be populated. Widening the WHERE to "has stripe ids" would sweep them in.
     * Exercised for real in the int test.
     */
    it('selects on billingProvider rather than on which columns are populated', () => {
      expect(source).toContain('billingProvider')
      expect(source).toContain("'stripe'")
      expect(source).not.toContain('shopify')
    })

    /** null billingProvider means "unlinked", which the provider registry resolves to Stripe. */
    it('counts a NULL billingProvider as in scope', () => {
      // Loose on the call shape — Vite rewrites bare imports to
      // `(0,__vite_ssr_import_2__.isNull)(…)` before `toString()` ever sees them.
      expect(source).toMatch(/isNull\)?\([^)]*PlanSubscription\.billingProvider/)
    })

    /**
     * Idempotency rests entirely on this ordering: the linked set is read BEFORE the
     * columns are nulled, so a re-run's predicate matches nothing. Reading after would make
     * the second pass a no-op by accident and the first pass wrong.
     */
    it('snapshots the linked set before nulling anything', () => {
      const read = source.indexOf('.select(')
      const planUpdate = source.indexOf('schema.Plan)')
      const unlink = source.indexOf('stripeCustomerId: null')
      expect(read).toBeGreaterThan(-1)
      expect(read).toBeLessThan(planUpdate)
      expect(read).toBeLessThan(unlink)
    })
  })
})
