// packages/database/src/db/schema/gl-role-assignment.ts
// Which of the org's OWN accounts fulfils each auxx posting role (decision G19).
//
// WHY A TABLE AND NOT A FIELD ON `gl_account`
// `G19` needs a DIRECTIONAL uniqueness: each ROLE resolves to exactly one
// account (required, enforced); each ACCOUNT may serve many roles (permitted and
// ordinary — an org that runs DTC and dealer revenue through one account).
//
//   - `gl_account.role`, SINGLE_SELECT + `unique`, enforces the constraint AND
//     its converse. It rejects the exact case `G19` names.
//   - `gl_account.roles`, MULTI_SELECT, cannot express "each role appears on at
//     most one account" at all: that is set-membership uniqueness ACROSS rows,
//     and `FieldValue` carries exactly two unique indexes — the PK and
//     `(entityId, fieldId, sortKey)`. Decision `G6`'s argument verbatim: not
//     unimplemented, unexpressible.
//   - This table: THREE partial unique indexes on `(organizationId, role, ...)`,
//     never one three-column unique — Postgres treats NULLs as distinct, so a
//     single composite would admit two org defaults for one role. The org
//     DEFAULT (unscoped); one per `FinancialSourceAccount` via `sourceAccountId`
//     (STORE scope, brief 47); one per `payment_gateway` + `coalesce(currency,
//     '')` via `paymentGatewayId` (RAIL scope, brief 58 — "which bank"/"which
//     clearing account" has no org-wide answer, so this axis exists to be
//     scoped, never defaulted). Postgres enforced, and many rows may share
//     `glAccountId`.
//
// 🛑 `gl_account` STAYS an `EntityInstance`. `RecordIdentity` is keyed on an
// instance and has no other addressing mode, and decision `P2` hangs the
// provider's account id there. This table sits BESIDE the chart; it does not
// table-ify it.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { FinancialSourceAccount } from './financial-source-account'
import { Organization } from './organization'
import { User } from './user'

/** One org's mapping of one posting role onto one of its own accounts. */
export const GlRoleAssignment = pgTable(
  'GlRoleAssignment',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /**
     * An `ACCOUNT_ROLES` value — `'grni'`, `'inventory_raw_materials'`, `'ppv'`.
     *
     * Plain `text`, NOT a `pgEnum`. The vocabulary lives in
     * `packages/lib/src/accounting/ledger/builders/entry.ts` and a second copy is the thing
     * that drifts; `GlPostingLine.accountRole` already made the same call for
     * the same reason. Adding a role would otherwise be a Postgres migration on
     * top of a one-line constant edit.
     */
    role: text().notNull(),

    /**
     * The `gl_account` `EntityInstance` id this role resolves to.
     *
     * 🛑 **No foreign key, deliberately** — the same call
     * `GlPostingLine.accountCode` makes. `cascade` would destroy an org's
     * posting configuration silently the moment somebody deleted an account;
     * `restrict` would block a bookkeeper from archiving one behind an error
     * message that cannot explain itself. The resolver validates existence,
     * active status and type compatibility on EVERY read and fails closed —
     * which `G19` requires anyway ("every close revalidates existence, active
     * status, and type compatibility") — so an FK buys nothing the validation
     * does not already have to do.
     */
    glAccountId: text().notNull(),

    /**
     * The `FinancialSourceAccount` this assignment is scoped to, or NULL for the
     * ORG-WIDE DEFAULT every unmapped source falls back to (task 47 §6.1).
     *
     * 🔑 The scope key is the merchant account's OWN identity - `providerKey` +
     * `externalAccountId` + `environment` - not our plumbing's. It survives a
     * reconnect, a connector rebuild and an app reinstall, which is exactly why
     * it is not `dataConnectorId` (a sync CONFIG, not 1:1 with a store, and
     * rebuilding one would move the books) and not `credentialId` (the
     * authorization to talk to the store, re-minted on every reconnect).
     *
     * 🛑 **NULL means "no override", and nothing else.** The MANUAL bucket - an
     * order with no connected source - is a real `FinancialSourceAccount` row
     * (`providerKey: 'auxx'`, `externalAccountId: 'manual'`), not a null and not
     * a `scopeKind` discriminator column. A discriminator would need a second
     * column, a check constraint keeping the two in sync, a third partial unique
     * index and a special case in every renderer; a row needs none of that and
     * makes every future scope a row too (47 §3).
     *
     * 🛑 Only the roles in `SCOPABLE_ROLES` (`postings/build-entry.ts`) may
     * carry one. `setRoleAssignment` refuses the rest by name.
     */
    sourceAccountId: text(),

    /** Rail scope: the `payment_gateway` EntityInstance this row answers for. Null for store scope or the org default. */
    paymentGatewayId: text(),

    /** Three-letter settlement currency; only a rail row may carry one. */
    currency: text(),

    /**
     * How this mapping came to be: `'seed'` | `'human'` | `'suggested'`.
     *
     * `G19` leans on the difference between a suggestion and a confirmation —
     * the setup wizard must render "we chose this for you" differently from
     * "you chose this". Cheap to carry now; a migration later.
     */
    source: text().notNull(),

    confirmedAt: timestamp({ precision: 3 }),
    confirmedByUserId: text().references((): AnyPgColumn => User.id, { onDelete: 'set null' }),

    /**
     * `G19`: an OPTIONAL role may be marked unused, which is different from
     * unmapped. An ABSENT row means "nobody has looked at this yet"; collapsing
     * the two would leave the wizard unable to tell a finished setup from an
     * untouched one. The resolver still fails closed when a builder emits a role
     * marked unused — the human said "we don't use this" and the books disagree.
     */
    markedUnused: boolean().default(false).notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // ── THE CONSTRAINT. These two lines are why the table exists. ──
    // One role, one account, per org, PER SOURCE. Nothing stops two roles naming
    // one account.
    //
    // 🛑 TWO PARTIAL indexes, never one three-column unique. Postgres treats
    // NULLs as distinct, so a single `(organizationId, role, sourceAccountId)`
    // unique would happily accept two org defaults for the same role - and
    // `resolveRoles` refuses to choose between two rows rather than picking one,
    // so that state takes the whole ledger down instead of being caught here.
    // `paymentGatewayId IS NULL` too: after 58 a rail row also has
    // `sourceAccountId IS NULL`, and without this it collides with the default here.
    uniqueIndex('GlRoleAssignment_org_role_default_key')
      .using('btree', table.organizationId.asc().nullsLast(), table.role.asc().nullsLast())
      .where(sql`${table.sourceAccountId} IS NULL AND ${table.paymentGatewayId} IS NULL`),
    uniqueIndex('GlRoleAssignment_org_role_source_key')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.role.asc().nullsLast(),
        table.sourceAccountId.asc().nullsLast()
      )
      .where(sql`${table.sourceAccountId} IS NOT NULL`),
    // The `coalesce` makes a currency-less rail row and a currencied rail row two
    // rows, and two currency-less rows for the same rail a conflict (58 §4.1).
    uniqueIndex('GlRoleAssignment_org_role_rail_key')
      .using(
        'btree',
        table.organizationId.asc().nullsLast(),
        table.role.asc().nullsLast(),
        table.paymentGatewayId.asc().nullsLast(),
        sql`coalesce(${table.currency}, '')`
      )
      .where(sql`${table.paymentGatewayId} IS NOT NULL`),

    // ⚠️ A real foreign key, and it does NOT contradict `glAccountId`'s
    // deliberate lack of one above. That argument is about a bookkeeper
    // archiving an ACCOUNT out from under a posting configuration.
    // `FinancialSourceAccount` is soft-archived (`archivedAt`) and never
    // deleted, and the four sibling money tables - `FinancialSourceObject`,
    // `FinancialSourceCoverage`, `MoneyTransfer`, `ProcessorBalanceEntry` -
    // already carry exactly this composite FK.
    foreignKey({
      name: 'GlRoleAssignment_sourceAccountId_fk',
      columns: [table.organizationId, table.sourceAccountId],
      foreignColumns: [FinancialSourceAccount.organizationId, FinancialSourceAccount.id],
    }),

    // Same shape as `PaymentRoute_paymentGatewayInstanceId_fk` — a rail row points
    // at the `payment_gateway` EntityInstance it is scoped to.
    foreignKey({
      name: 'GlRoleAssignment_paymentGatewayId_fk',
      columns: [table.organizationId, table.paymentGatewayId],
      foreignColumns: [EntityInstance.organizationId, EntityInstance.id],
    }).onDelete('no action'),

    // A row is scoped to a source XOR a rail, never both.
    check(
      'GlRoleAssignment_scope_exclusive_check',
      sql`num_nonnulls(${table.sourceAccountId}, ${table.paymentGatewayId}) <= 1`
    ),
    check(
      'GlRoleAssignment_currency_rail_check',
      sql`${table.currency} IS NULL OR ${table.paymentGatewayId} IS NOT NULL`
    ),
    check(
      'GlRoleAssignment_currency_format_check',
      sql`${table.currency} IS NULL OR ${table.currency} ~ '^[A-Z]{3}$'`
    ),

    // "Which roles does this account serve?" — the admin list, and the read the
    // archive path needs before it can warn.
    index('GlRoleAssignment_org_account_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.glAccountId.asc().nullsLast()
    ),
  ]
)

export type GlRoleAssignmentEntity = typeof GlRoleAssignment.$inferSelect
export type CreateGlRoleAssignmentInput = typeof GlRoleAssignment.$inferInsert
