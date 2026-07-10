// packages/database/src/db/schema/payment-transaction.ts
// Money ledger — the sole source of truth for invoice payment state (plans/dispatch/money/04-payments.md,
// 06-mi1-build.md §E.1). Stripe columns ship dormant in v1 (manual payments only); MP1 wires the
// webhook path onto the same rows.

import { createId } from '@paralleldrive/cuid2'
import type { PaymentProvider, PaymentTransactionKind, PaymentTransactionStatus } from '../../enums'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/**
 * One row per money movement (charge or refund) against an invoice. The ledger is the
 * sanctioned writer for invoice payment mirrors (`invoice_amount_paid`/`invoice_balance`/
 * status) — see `syncInvoicePaymentState` (§E.4). v1 rows are all `manual` `charge`s;
 * MP1 adds the Stripe rail onto the same table (columns below ship dormant until then).
 */
export const PaymentTransaction = pgTable(
  'PaymentTransaction',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** plain text until MP1 creates PaymentAccount + adds the FK */
    paymentAccountId: text(),
    /** 'manual' | 'stripe' */
    provider: text().$type<PaymentProvider>().notNull(),
    /** 'charge' | 'refund' */
    kind: text().$type<PaymentTransactionKind>().notNull(),
    /** 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'disputed' */
    status: text().$type<PaymentTransactionStatus>().notNull(),
    /** minor units (integer cents — the MQ1 convention) */
    amount: integer().notNull(),
    currency: text().notNull(),
    applicationFeeAmount: integer(),
    invoiceInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'restrict',
      }),
    paymentInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** cash/check/card/bank/other (stripe rows stamp from the charge) */
    method: text(),
    reference: text(),
    note: text(),
    /** unique below — webhook idempotency (MP1) */
    stripePaymentIntentId: text(),
    stripeChargeId: text(),
    stripeCheckoutSessionId: text(),
    stripeRefundId: text(),
    refundedTransactionId: text().references((): AnyPgColumn => PaymentTransaction.id, {
      onDelete: 'set null',
    }),
    failureCode: text(),
    failureMessage: text(),
    createdByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    metadata: jsonb(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('PaymentTransaction_organizationId_invoiceInstanceId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.invoiceInstanceId.asc().nullsLast()
    ),
    // PG: multiple NULLs allowed — only enforces uniqueness among rows that carry a value
    uniqueIndex('PaymentTransaction_stripePaymentIntentId_key').using(
      'btree',
      table.stripePaymentIntentId.asc().nullsLast()
    ),
  ]
)

export type PaymentTransactionEntity = typeof PaymentTransaction.$inferSelect
export type PaymentTransactionInsert = typeof PaymentTransaction.$inferInsert
