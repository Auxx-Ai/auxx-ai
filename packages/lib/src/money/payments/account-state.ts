// packages/lib/src/money/payments/account-state.ts
// The `PaymentAccount` data layer for money MP1 (07-mp1-build.md §D.4). Functional module (no
// model class, repo rule) — direct drizzle + thrown `AuxxError`s, matching MI1's `ledger.ts`
// style. The `stripeConnectHandler` (`connect.ts`) and the `money` router (§L) both compose
// these — this file is the ONLY writer to the `PaymentAccount` table.

import { deleteCredential } from '@auxx/credentials/store'
import type { PaymentAccountEntity, PaymentAccountInsert } from '@auxx/database'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { getStripeConnectClient } from './connect-client'

const logger = createScopedLogger('money:payments:account-state')

/** Fields `upsertPaymentAccount` can create-or-update — all beyond the key are optional. */
export interface UpsertPaymentAccountInput {
  organizationId: string
  provider: PaymentAccountInsert['provider']
  accountType?: PaymentAccountInsert['accountType']
  stripeAccountId?: string | null
  credentialId?: string | null
  chargesEnabled?: boolean
  detailsSubmitted?: boolean
  defaultCurrency?: string | null
  applicationFeePercent?: string | null
  disconnectedAt?: Date | null
}

/** Load the org's `PaymentAccount` row for a provider (defaults to `'stripe'`), or `null`. */
export async function getPaymentAccount(
  organizationId: string,
  provider: PaymentAccountInsert['provider'] = 'stripe'
): Promise<PaymentAccountEntity | null> {
  const row = await database.query.PaymentAccount.findFirst({
    where: and(
      eq(schema.PaymentAccount.organizationId, organizationId),
      eq(schema.PaymentAccount.provider, provider)
    ),
  })
  return row ?? null
}

/**
 * Create-or-update the org's `PaymentAccount` row, keyed on `(organizationId, provider)`. Only
 * the fields present on `input` are written — omitted fields are left untouched on an existing
 * row (and fall back to their column default on first insert). Callers: the `stripeConnectHandler`
 * `start` (persists the acct id the moment it's created), `complete`/`onPersisted` (stamps
 * onboarding state + the Credential id), `syncAccountState` (§D.4), and `disconnectPaymentAccount`.
 */
export async function upsertPaymentAccount(
  input: UpsertPaymentAccountInput
): Promise<PaymentAccountEntity> {
  const { organizationId, provider, ...rest } = input

  const values: PaymentAccountInsert = { organizationId, provider }
  const set: Partial<PaymentAccountInsert> = { updatedAt: new Date() }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue
    ;(values as Record<string, unknown>)[key] = value
    ;(set as Record<string, unknown>)[key] = value
  }

  const [row] = await database
    .insert(schema.PaymentAccount)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.PaymentAccount.organizationId, schema.PaymentAccount.provider],
      set,
    })
    .returning()

  return row!
}

/**
 * Refresh `chargesEnabled`/`detailsSubmitted`/`defaultCurrency` from Stripe (`accounts.retrieve`
 * — platform-level, no `stripeAccount` header needed to look up an account by id). Called by the
 * `hosted-provision` return route, the `account.updated` webhook (§F), and the settings page's
 * "Refresh status" button (§G).
 */
export async function syncAccountState(
  organizationId: string,
  stripeAccountId: string
): Promise<PaymentAccountEntity> {
  const stripe = getStripeConnectClient()
  const acct = await stripe.accounts.retrieve(stripeAccountId)

  return upsertPaymentAccount({
    organizationId,
    provider: 'stripe',
    stripeAccountId,
    chargesEnabled: acct.charges_enabled ?? false,
    detailsSubmitted: acct.details_submitted ?? false,
    defaultCurrency: acct.default_currency ?? null,
  })
}

/**
 * Disconnect the org's Stripe account (`money.disconnectPayments`, §L/§C.6): stamps
 * `disconnectedAt` and nulls `credentialId`, deleting the underlying Credential row when one
 * exists. The `acct_…` itself is left alone — it persists at Stripe, and a reconnect re-enters
 * onboarding and finds the same account (`stripeConnectHandler.start`). Note:
 * `PaymentAccount.credentialId` FKs `onDelete: 'set null'`, so a generic connection-delete
 * elsewhere would also null this column — this path additionally stamps `disconnectedAt` and
 * removes the Credential explicitly for the "Disconnect" button's own path.
 */
export async function disconnectPaymentAccount(
  organizationId: string
): Promise<PaymentAccountEntity> {
  const account = await getPaymentAccount(organizationId)
  if (!account) {
    throw new NotFoundError('No payment account connected for this organization')
  }

  if (account.credentialId) {
    const result = await deleteCredential(account.credentialId, organizationId)
    if (result.isErr()) {
      // Already gone (e.g. deleted via the FK's own set-null path) — don't block the stamp.
      logger.warn('Failed to delete PaymentAccount credential on disconnect', {
        organizationId,
        credentialId: account.credentialId,
        error: result.error,
      })
    }
  }

  return upsertPaymentAccount({
    organizationId,
    provider: 'stripe',
    credentialId: null,
    disconnectedAt: new Date(),
  })
}
