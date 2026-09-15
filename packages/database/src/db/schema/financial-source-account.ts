// packages/database/src/db/schema/financial-source-account.ts
import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, check, pgTable, sql, text, timestamp, unique } from './_shared'
import { Organization } from './organization'

/** Durable FinancialSourceAccount owner; organization deletion cascades, scoped financial references preserve history. */
export const FinancialSourceAccount = pgTable(
  'FinancialSourceAccount',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    providerKey: text().notNull(),
    externalAccountId: text().notNull(),
    environment: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    /**
     * The human label a person gave this account, e.g. "Primary Shopify Payments".
     *
     * Nullable because a `FinancialSourceAccount` row is minted by a sync
     * (`source-scope.ts`), not by a person - it exists the moment a connector
     * reports evidence against it, long before anybody has looked at it. Null
     * means "nobody has named it yet", not "unnamed by policy". `externalAccountId`
     * stays the machine identity (part of the org/provider/id/environment unique
     * key above); this column is display-only and never participates in identity
     * or lookup.
     */
    name: text(),
    /**
     * Which side of the business this account sits on: `'store'` (a storefront,
     * e.g. Shopify), `'processor'` (a payment rail's own account, e.g. Shopify
     * Payments or Stripe), or `'both'` for a provider that is simultaneously the
     * store and the processor.
     *
     * Nullable because classification lags discovery: a row can exist from
     * synced evidence before anything has decided which axis it belongs to.
     * Not read anywhere yet - `source-scope.ts` currently derives the axis set
     * per-org from `FinancialSourceObject`/`ProcessorBalanceEntry`/`MoneyTransfer`
     * evidence rather than from a stored column; this field is scaffolding for
     * that to move onto the row itself later.
     */
    axis: text(),
  },
  (t) => [
    unique('FinancialSourceAccount_org_id_key').on(t.organizationId, t.id),
    unique('FinancialSourceAccount_identity_key').on(
      t.organizationId,
      t.providerKey,
      t.externalAccountId,
      t.environment
    ),
    check(
      'FinancialSourceAccount_identity_check',
      sql`length(${t.providerKey}) > 0 AND length(${t.externalAccountId}) > 0 AND ${t.environment} IN ('live', 'test')`
    ),
    check(
      'FinancialSourceAccount_axis_check',
      sql`${t.axis} IS NULL OR ${t.axis} IN ('store', 'processor', 'both')`
    ),
  ]
)
