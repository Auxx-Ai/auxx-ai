// packages/database/src/db/schema/payment-account.ts
// The org's Stripe Connect anchor (money MP1 — 07-mp1-build.md §B.1). One row per
// (organizationId, provider) — v1 only ever provisions `stripe`. `credentialId` links back to
// the Credential row the `hosted-provision` connection flow persists; `PaymentTransaction.
// paymentAccountId` (payment-transaction.ts) FKs onto this table.

import { createId } from '@paralleldrive/cuid2'
import type { PaymentAccountType, PaymentProvider } from '../../enums'
import {
  type AnyPgColumn,
  boolean,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Credential } from './credential'
import { Organization } from './organization'

/**
 * One row per org-connected payment provider account. `stripeAccountId` is null until Account
 * Links onboarding returns (money MP1 build spec §C.4/§D.2); `chargesEnabled`/
 * `detailsSubmitted`/`defaultCurrency` mirror `accounts.retrieve` (`syncAccountState`,
 * §D.4). `applicationFeePercent` is a per-org override (column-only, no UI in v1) — null falls
 * back to the `PAYMENTS_APPLICATION_FEE_PERCENT` global default (`resolveApplicationFee`, §D.3).
 * `disconnectedAt` is stamped by `disconnectPaymentAccount` (§C.6); the Stripe `acct_…` itself
 * survives disconnect — reconnect re-enters onboarding and finds the same account.
 */
export const PaymentAccount = pgTable(
  'PaymentAccount',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** 'manual' | 'stripe' — v1 only ever provisions 'stripe' rows here. */
    provider: text().$type<PaymentProvider>().notNull(),
    /** 'standard' | 'express' — 'express' reserved for a later markup-pricing milestone (MP2). */
    accountType: text().$type<PaymentAccountType>().notNull().default('standard'),
    /** acct_… — null until Account Links onboarding returns. */
    stripeAccountId: text(),
    /** The `hosted-provision` connection's Credential row — null pre-onboarding or post-disconnect. */
    credentialId: text().references((): AnyPgColumn => Credential.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    chargesEnabled: boolean().notNull().default(false),
    detailsSubmitted: boolean().notNull().default(false),
    defaultCurrency: text(),
    /** Per-org fee override, e.g. '1.5' — null means "use the global default". */
    applicationFeePercent: numeric(),
    disconnectedAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('PaymentAccount_organizationId_provider_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.provider.asc().nullsLast()
    ),
  ]
)

export type PaymentAccountEntity = typeof PaymentAccount.$inferSelect
export type PaymentAccountInsert = typeof PaymentAccount.$inferInsert
