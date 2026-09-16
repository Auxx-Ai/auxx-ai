// packages/database/src/db/schema/accounting-work.ts

import { createId } from '@paralleldrive/cuid2'
import type { PgTableExtraConfigValue } from 'drizzle-orm/pg-core'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from './_shared'
import { AccountingEffect } from './accounting-effect'
import { EntityInstance } from './entity-instance'
import { MoneyTransaction } from './money-transaction'
import { Organization } from './organization'

/**
 * The families whose owner may carry MORE THAN ONE original obligation.
 *
 * 🔑 The exception list for `AccountingWork_fulfillment_original_key` and
 * `AccountingWork_money_original_key`. Membership is a statement about the
 * BUSINESS, not about the code: an invoice really can be written off twice, and
 * a receipt really can be applied to two invoices. Everything not named here is
 * 1:1 with its owner and keeps the guarantee.
 */
export const REPEATABLE_ACCOUNTING_EFFECT_KINDS = ['invoice_write_off', 'deposit_application']

/** The entity-owned families that are exactly one original per `EntityInstance`. */
const ENTITY_OWNED_EFFECT_KINDS = [
  'fulfillment_accounting',
  'customer_credit_issued',
  'invoice_issued',
  'invoice_write_off',
  'payout_settlement',
  'expense_bill',
  'vendor_bill_matched',
  'inventory_receipt',
]

/** The money-owned families, whose owner is a `MoneyTransaction`. */
const MONEY_OWNED_EFFECT_KINDS = ['customer_receipt', 'customer_refund', 'deposit_application']

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ')

const oneOriginalPerOwner = (kinds: readonly string[]) =>
  kinds.filter((kind) => !REPEATABLE_ACCOUNTING_EFFECT_KINDS.includes(kind))

/** Durable AccountingWork identity for accounting acceptance and recovery. */
export const AccountingWork = pgTable(
  'AccountingWork',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    entityInstanceId: text(),
    moneyTransactionId: text(),
    /**
     * Which transaction-driven accounting family this obligation belongs to.
     *
     * The first four are the 42D/42E families. The seven that follow are D19
     * (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3): the
     * transaction-driven `GlPostingType` families that posted straight through
     * `postEntry` with no durable obligation behind them, and so had nowhere to
     * carry an accrual/cash basis (D13).
     *
     * 🛑 Deliberately absent: the seven families whose posting IS the source
     * (`manual_journal`, `opening_balance`, `provider_sync`, the three
     * `month_end_*` types, `recurring_journal`) stay 1:1 and carry their basis
     * on `GlPosting`; `bank_transaction`/`bank_deposit` are deferred; `build`
     * belongs to task 40.
     *
     * ## 🔑 Two of these families are REPEATABLE, and that is what
     * {@link REPEATABLE_ACCOUNTING_EFFECT_KINDS} exists for
     *
     * `AccountingWork_fulfillment_original_key` and
     * `AccountingWork_money_original_key` say "one original per owner per kind".
     * That is TRUE of a fulfillment, an invoice issuance, a payout; it is FALSE
     * of a write-off (one invoice can be written off in parts, on different
     * days, each its own bad debt) and of a deposit application (one receipt can
     * be applied to several invoices). Both indexes are therefore narrowed to
     * the genuinely 1:1 kinds. The repeatable ones are protected by
     * `AccountingWork_org_effect_key` instead, whose `effectKey` is derived per
     * OCCURRENCE — the write-off's attempt, the application's own id — rather
     * than per owner.
     *
     * 🛑 A repeat is **not** `operation: 'correction'`. A correction says the
     * first entry was a mistake. A July write-off after a March one is new bad
     * debt on its own date, and recording it as a correction would misstate the
     * month the loss happened. `AccountingWork_correction_check` is unchanged.
     *
     * ⚠️ **A value here means the vocabulary is open, not that the family is
     * wired.** `invoice_issued` (`money/invoices/issuance-accounting.ts`),
     * `invoice_write_off` (`money/invoices/write-off-accounting.ts`) and
     * `deposit_application`
     * (`money/customer-money/deposit-application-accounting.ts`) post through an
     * accepted effect. The remaining four are reserved because widening this
     * CHECK later is a migration and carrying a value nothing writes is free —
     * and each is blocked on something specific:
     *
     * | value | what still blocks it |
     * | --- | --- |
     * | `payout_settlement` | the acceptance revalidator must re-derive the gross/fees/net split inside the locked transaction; today it arrives from a provider gather in `money/payouts/sync.ts` |
     * | `expense_bill` | posts from `lib/src/purchasing/expense-bill/writes.ts`, a module outside the money/postings lane |
     * | `vendor_bill_matched` | ⚠️ `buildVendorBillEntry` has NO posting caller. Built and tested, never posted |
     * | `inventory_receipt` | ⚠️ `buildReceiptEntry` has NO posting caller either |
     *
     * ⚠️ `deposit_application` is wired but has no TRAFFIC yet: its upstream is a
     * `MoneyApplication` carrying `invoiceInstanceId`, and the only writer of
     * `MoneyApplication` today (`money/customer-money/ingest.ts`) applies money
     * to ORDERS. The dispatch-era `PaymentAllocation` lane still posts its own
     * `deposit_application` journals through `money/payments/post-deposit-application.ts`;
     * that lane is not an `AccountingWork` owner and is not going to become one.
     */
    effectKind: text()
      .notNull()
      .$type<
        | 'fulfillment_accounting'
        | 'customer_receipt'
        | 'customer_credit_issued'
        | 'customer_refund'
        | 'invoice_issued'
        | 'invoice_write_off'
        | 'payout_settlement'
        | 'expense_bill'
        | 'vendor_bill_matched'
        | 'inventory_receipt'
        | 'deposit_application'
      >(),
    componentKey: text().notNull().default('original'),
    effectKey: text().notNull(),
    operation: text().notNull().$type<'original' | 'correction'>(),
    correctsEffectId: text(),
    basisVersion: integer().notNull(),
    state: text().notNull().$type<'pending' | 'blocked' | 'accepted' | 'no_effect' | 'canceled'>(),
    eligibility: text().notNull().$type<'automatic' | 'manual' | 'excluded'>(),
    blockedReason: text(),
    nextAttemptAt: timestamp({ withTimezone: true }),
    leaseUntil: timestamp({ withTimezone: true }),
    leaseToken: text(),
    attempts: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('AccountingWork_org_id_key').on(t.organizationId, t.id),
    unique('AccountingWork_org_effect_key').on(t.organizationId, t.effectKey),
    // 🛑 Both partial uniques are narrowed to the kinds that are genuinely one
    // original per owner. A repeatable kind is kept honest by
    // `AccountingWork_org_effect_key`, whose key already carries the occurrence.
    // See {@link REPEATABLE_ACCOUNTING_EFFECT_KINDS}.
    uniqueIndex('AccountingWork_fulfillment_original_key')
      .on(t.organizationId, t.entityInstanceId, t.effectKind)
      .where(
        sql.raw(
          `"operation" = 'original' AND "effectKind" IN (${quoted(oneOriginalPerOwner(ENTITY_OWNED_EFFECT_KINDS))})`
        )
      ),
    uniqueIndex('AccountingWork_money_original_key')
      .on(t.organizationId, t.moneyTransactionId, t.effectKind)
      .where(
        sql.raw(
          `"operation" = 'original' AND "effectKind" IN (${quoted(oneOriginalPerOwner(MONEY_OWNED_EFFECT_KINDS))})`
        )
      ),
    foreignKey({
      name: 'AccountingWork_entity_scope_fk',
      columns: [t.organizationId, t.entityInstanceId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingWork_money_scope_fk',
      columns: [t.organizationId, t.moneyTransactionId],
      foreignColumns: [MoneyTransaction.organizationId, MoneyTransaction.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'AccountingWork_correction_scope_fk',
      columns: [t.organizationId, t.correctsEffectId],
      foreignColumns: [AccountingEffect.organizationId, AccountingEffect.id],
    }).onDelete('no action'),
    check(
      'AccountingWork_kind_check',
      sql`(${t.effectKind} IN (${sql.raw(quoted(ENTITY_OWNED_EFFECT_KINDS))}) AND ${t.entityInstanceId} IS NOT NULL AND ${t.moneyTransactionId} IS NULL) OR (${t.effectKind} IN (${sql.raw(quoted(MONEY_OWNED_EFFECT_KINDS))}) AND ${t.moneyTransactionId} IS NOT NULL AND ${t.entityInstanceId} IS NULL)`
    ),
    check(
      'AccountingWork_correction_check',
      sql`(${t.operation} = 'original' AND ${t.correctsEffectId} IS NULL AND ${t.componentKey} = 'original') OR (${t.operation} = 'correction' AND ${t.correctsEffectId} IS NOT NULL)`
    ),
    check(
      'AccountingWork_state_check',
      sql`${t.state} IN ('pending', 'blocked', 'accepted', 'no_effect', 'canceled')`
    ),
    check(
      'AccountingWork_eligibility_check',
      sql`${t.eligibility} IN ('automatic', 'manual', 'excluded')`
    ),
    check('AccountingWork_version_check', sql`${t.basisVersion} > 0 AND ${t.attempts} >= 0`),
    check('AccountingWork_lease_check', sql`(${t.leaseUntil} IS NULL) = (${t.leaseToken} IS NULL)`),
    index('AccountingWork_retry_idx').on(t.organizationId, t.state, t.eligibility, t.nextAttemptAt),
  ]
)

export type AccountingWorkEntity = typeof AccountingWork.$inferSelect
