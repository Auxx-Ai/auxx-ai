// packages/lib/src/data-migrations/migrations/094-stripe-account-cutover.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-094')

/** Statuses whose entitlement came from a Stripe subscription that no longer exists. */
const TERMINATE_STATUSES = ['trialing', 'past_due', 'incomplete'] as const

/** Plan names treated as free when `planId` is null and we cannot read `Plan.isFree`. */
const FREE_PLAN_NAMES = new Set(['free', 'demo'])

/**
 * Stripe account cutover (`plans/billing/stripe-account-migration.md` §3c): drop every pointer
 * into the legacy Stripe account `acct_1T8Cu1RtpSux2lhZ` so the app can be re-pointed at
 * `acct_1TLVTnDXcNjD5O4X` ("Auxx AI, LLC").
 *
 * Product/price/customer/subscription ids are account-scoped — an id minted on the old account
 * 404s against the new one. Entitlement, though, is ours: which plan an org is on and until when
 * lives in `PlanSubscription`, not in Stripe. So this nulls the *pointers* and leaves the
 * *entitlement* alone wherever a human could still be relying on it.
 *
 * ## Ordering
 *
 * Must run AFTER `STRIPE_SECRET_KEY` points at the new account and BEFORE `syncToStripe`.
 * `PlanAdminService.syncToStripe` calls `products.update(stripeProductId)` whenever the column is
 * set, which 404s cross-account; with the column null it takes the create path cleanly. Checkout
 * throws `PRICE_NOT_CONFIGURED` between this migration and the two `/admin/plans` sync clicks —
 * that window is expected and is why the runbook keeps those steps back to back.
 *
 * ## What this does NOT do
 *
 * - **Does not touch Shopify rows.** `billingProvider = 'shopify'` has its own lifecycle
 *   (`shopify-billing-sync-job`, `shopify-seat-usage-job`) and is unaffected by the Stripe move.
 *   Seeded Shopify rows can still carry stray `stripe*` ids, so the scope is explicit rather than
 *   inferred from which columns happen to be populated.
 * - **Does not cancel free-plan rows.** An org on Free never needed Stripe to hold its
 *   entitlement; it only ever had a $0 subscription because the seeder mints Stripe products for
 *   free plans (`billing.domain.ts` excludes custom pricing, not free). Unlinking is the whole
 *   change for those rows.
 * - **Does not touch rows under admin override.** A non-null `adminOverrideAt` means a super
 *   admin owns the row's lifecycle and no reconciler may write status — the same rule
 *   `subscription-updated.ts` enforces. Comped orgs keep their plan.
 * - **Does not cancel `active` paid rows.** There should be none (the legacy account has $0 gross
 *   volume and no successful payment), but silently downgrading a paying customer is far worse
 *   than leaving a row that needs a human. Any that exist are logged loudly and left alone.
 *
 * ## Why `hasTrialEnded` is forced on the rows it terminates
 *
 * Three maintenance jobs use `stripeSubscriptionId IS NULL` as their proxy for "has no active
 * subscription": `trial-conversion-job` (trial ending in ~3 days), `mid-trial-job` (trial started
 * ~7 days ago) and `expired-trial-account-cleanup-job` (warn at 7d/13d, delete the org at 14d).
 * Unlinking alone would make every legacy trial row newly eligible and fire real emails at the
 * bot addresses that created them. Both trial-email jobs additionally require
 * `hasTrialEnded = false`, so setting it true is what actually stops them.
 *
 * `trialConversionStatus` is deliberately left as-is rather than set to `CANCELED_DURING_TRIAL`:
 * the cleanup job matches `trialConversionStatus IN ('EXPIRED_WITHOUT_CONVERSION',
 * 'CANCELED_DURING_TRIAL')`, so writing either value would arm the 14-day org-deletion pipeline
 * on rows this migration just touched. Deleting the dead signups is a deliberate admin action,
 * not a side effect of a pointer cleanup.
 *
 * ## Idempotency
 *
 * The linked set is snapshotted BEFORE the nulling, so a re-run selects nothing and no-ops.
 * That snapshot is also why steps 1–4 must share one transaction: nulling the pointers
 * destroys the only evidence of which rows still needed closing out, so a partial commit
 * could never be repaired by re-running. See the note in `run`.
 *
 * Raw Drizzle throughout — data migrations do not use the `ensure*` entity helpers.
 *
 * ## Environments
 *
 * This runs wherever the worker boots, dev included. Dev/staging `Plan` rows lose their test-mode
 * ids too and need their own `syncToStripe` pass against the new account's test mode before
 * checkout works there again.
 */
export const migration094StripeAccountCutover: DataMigrationDef = {
  id: '094-stripe-account-cutover',
  description:
    'Drop legacy Stripe account pointers from Plan and PlanSubscription (Atlas account cutover)',
  async run(db: Database): Promise<void> {
    // Steps 1–4 run in ONE transaction. The snapshot-before-nulling that gives this
    // migration its idempotency also removes its recovery path: once step 3 nulls the
    // pointers, a re-run selects nothing. So if step 3 committed and step 4 did not, the
    // retry would find `linked` empty and never close out the rows that needed terminating —
    // leaving exactly the `trialing` + `hasTrialEnded = false` + no-subscription state that
    // makes every legacy trial row eligible for the trial-email and org-deletion jobs. The
    // runner calls `run(db)` with no transaction of its own (`run-pending-data-migrations.ts`),
    // so partial application has to be made unrepresentable here.
    const { linked, activePaid, toTerminate, clearedPlans } = await db.transaction(async (tx) => {
      // ── 1. Snapshot the Stripe-linked subscriptions BEFORE nulling ──────────────
      // Reading first is what makes the migration idempotent: after the update the
      // predicate matches nothing, so a re-run is a clean no-op.
      const linkedRows = await tx
        .select({
          id: schema.PlanSubscription.id,
          organizationId: schema.PlanSubscription.organizationId,
          status: schema.PlanSubscription.status,
          planName: schema.PlanSubscription.plan,
          isFree: schema.Plan.isFree,
          adminOverrideAt: schema.PlanSubscription.adminOverrideAt,
          hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
        })
        .from(schema.PlanSubscription)
        .leftJoin(schema.Plan, eq(schema.Plan.id, schema.PlanSubscription.planId))
        .where(
          and(
            // Stripe rows only. `billingProvider` defaults to 'stripe' and null means
            // "unlinked", which the provider registry also resolves to Stripe.
            or(
              eq(schema.PlanSubscription.billingProvider, 'stripe'),
              isNull(schema.PlanSubscription.billingProvider)
            ),
            or(
              isNotNull(schema.PlanSubscription.stripeCustomerId),
              isNotNull(schema.PlanSubscription.stripeSubscriptionId)
            )
          )
        )

      const isFreeRow = (row: (typeof linkedRows)[number]) =>
        row.isFree ?? FREE_PLAN_NAMES.has(row.planName.toLowerCase())

      // Paid rows still marked `active` should not exist — the legacy account never took a
      // payment. If one does, the audit behind this migration was wrong: surface it instead of
      // downgrading someone who might be paying.
      const activePaid = linkedRows.filter(
        (r) => r.status === 'active' && !isFreeRow(r) && !r.adminOverrideAt
      )
      if (activePaid.length > 0) {
        logger.warn(
          'Active paid subscriptions found on the legacy account — unlinked but NOT canceled; these need a human',
          {
            count: activePaid.length,
            subscriptions: activePaid.map((r) => ({
              id: r.id,
              organizationId: r.organizationId,
              plan: r.planName,
            })),
          }
        )
      }

      // Rows whose entitlement was genuinely backed by a Stripe subscription that is about to
      // become unreachable, and that nothing else is holding open.
      const toTerminate = linkedRows.filter(
        (r) =>
          !r.adminOverrideAt &&
          !isFreeRow(r) &&
          (TERMINATE_STATUSES as readonly string[]).includes(r.status)
      )

      // ── 2. Null the Plan product/price pointers ─────────────────────────────────
      // Every plan, including Demo/Free/Enterprise. `syncToStripe` refuses free and
      // custom-pricing plans, so those three stay null permanently — which is correct. Leaving
      // their legacy ids in place would point at objects on an account we no longer hold keys
      // for, and mislead whoever debugs billing next.
      const clearedPlanRows = await tx
        .update(schema.Plan)
        .set({
          stripeProductId: null,
          stripePriceIdMonthly: null,
          stripePriceIdAnnual: null,
          updatedAt: new Date(),
        })
        .where(
          or(
            isNotNull(schema.Plan.stripeProductId),
            isNotNull(schema.Plan.stripePriceIdMonthly),
            isNotNull(schema.Plan.stripePriceIdAnnual)
          )
        )
        .returning({ id: schema.Plan.id, name: schema.Plan.name })

      // ── 3. Unlink the subscriptions ─────────────────────────────────────────────
      // Entitlement (planId, status, trial dates, seats, credits) is deliberately preserved.
      // The next checkout mints a fresh customer: `CustomerService.getOrCreateCustomer` falls
      // through to an email lookup and then `customers.create`, and
      // `handleCheckoutSessionCompleted` re-links by OUR subscription id carried in checkout
      // metadata — so no duplicate row and no unique-constraint fight.
      if (linkedRows.length > 0) {
        await tx
          .update(schema.PlanSubscription)
          .set({ stripeCustomerId: null, stripeSubscriptionId: null })
          .where(
            inArray(
              schema.PlanSubscription.id,
              linkedRows.map((r) => r.id)
            )
          )
      }

      // ── 4. Close out the rows whose backing subscription is gone ────────────────
      if (toTerminate.length > 0) {
        const now = new Date()
        await tx
          .update(schema.PlanSubscription)
          .set({
            status: 'canceled',
            canceledAt: now,
            endDate: now,
            cancelAtPeriodEnd: false,
            // Stops trial-conversion-job and mid-trial-job, both of which gate on
            // `hasTrialEnded = false`. See the header note on why trialConversionStatus
            // is left untouched.
            hasTrialEnded: true,
            // A dangling schedule would be applied against a subscription that no longer
            // exists by apply-scheduled-subscription-changes-job.
            scheduledPlanId: null,
            scheduledPlan: null,
            scheduledBillingCycle: null,
            scheduledSeats: null,
            scheduledChangeAt: null,
          })
          .where(
            inArray(
              schema.PlanSubscription.id,
              toTerminate.map((r) => r.id)
            )
          )
      }

      return {
        linked: linkedRows,
        activePaid,
        toTerminate,
        clearedPlans: clearedPlanRows,
      }
    })

    // ── 5. Recompute the org cache ──────────────────────────────────────────────
    // Deliberately OUTSIDE the transaction: Redis does not roll back, so priming the cache
    // from rows that a later abort would undo is worse than a stale key. By here the DB is
    // committed. A crash mid-loop leaves the remaining orgs serving legacy ids until their
    // TTL, and a re-run will not repair it (the migration is applied) — flush the org cache
    // by hand if this step is interrupted.
    // `CachedSubscription` carries `stripeCustomerId` and `stripeSubscriptionId` verbatim
    // (cache/providers/subscription-provider.ts), so without this the cache keeps serving
    // legacy ids after the columns are null. `features` is derived from the plan and moves
    // with any status change.
    const affectedOrgs = new Set(linked.map((r) => r.organizationId))
    for (const orgId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(orgId, ['subscription', 'features'])
    }

    logger.info('Stripe account cutover complete', {
      plansCleared: clearedPlans.length,
      planNames: clearedPlans.map((p) => p.name),
      subscriptionsUnlinked: linked.length,
      subscriptionsTerminated: toTerminate.length,
      activePaidLeftForReview: activePaid.length,
      orgsInvalidated: affectedOrgs.size,
    })
  },
}
