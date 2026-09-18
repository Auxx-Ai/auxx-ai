// packages/database/src/db/schema/financial-source-account.ts
import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  unique,
} from './_shared'
import { EntityInstance } from './entity-instance'
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
    /** The rail this feed settles for. Null until a person links it; a rail nothing points at is manual. */
    paymentGatewayId: text(),
    /** T14: `auto` sends a fully paid fulfillment as a Sales Receipt, else Invoice + Payment. */
    exportShape: text().notNull().default('auto').$type<'auto' | 'invoice'>(),
    /** Summary mode's placeholder customer at the provider, keyed by provider id: `{ quickbooks: { customerId } }`. */
    providerCustomerRef: jsonb().$type<Record<string, { customerId: string }>>(),
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
    // Same shape as `PaymentRoute_paymentGatewayInstanceId_fk` — the feed points
    // at the `payment_gateway` EntityInstance it settles for.
    foreignKey({
      name: 'FinancialSourceAccount_paymentGatewayId_fk',
      columns: [t.organizationId, t.paymentGatewayId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),
  ]
)
