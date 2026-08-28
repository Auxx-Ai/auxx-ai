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
//   - This table: `uniqueIndex(organizationId, role)`. One line, Postgres
//     enforced, and many rows may share `glAccountId`.
//
// 🛑 `gl_account` STAYS an `EntityInstance`. `RecordIdentity` is keyed on an
// instance and has no other addressing mode, and decision `P2` hangs the
// provider's account id there. This table sits BESIDE the chart; it does not
// table-ify it.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
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
     * `packages/lib/src/postings/build-entry.ts` and a second copy is the thing
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
    // ── THE CONSTRAINT. This line is why the table exists. ──
    // One role, one account, per org. Nothing stops two roles naming one account.
    uniqueIndex('GlRoleAssignment_org_role_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.role.asc().nullsLast()
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
