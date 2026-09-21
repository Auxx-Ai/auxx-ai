// packages/lib/src/accounting/ledger/roles/role-assignments.ts

/**
 * The one door onto `GlRoleAssignment` (task 58 §4.9) - `chart-accounts.ts`'s
 * argument applied to the other half of the pair: one decode, callers own
 * only their output shape. Before this, eight readers each wrote their own
 * `select`, which is eight places to edit the day the rows come from a cache
 * instead (§10.4).
 *
 * 🛑 **Returns ROWS, never a resolved account.** The moment this joins
 * `gl_account` it carries the archive flag inside it, and §10.4's cache
 * precondition - "the key holds the raw rows and never a resolved account" -
 * is gone.
 *
 * Whole-org, not by-role, deliberately: a by-role read cannot become one
 * cache key, and an org's whole map is a few dozen rows.
 *
 * TODO(58 §10.4): the future `OrgCacheDataMap` key goes here, keyed on the
 * whole-org read below; a `Transaction` must bypass it - `setRoleAssignment`
 * reads after its own write.
 *
 * No permission checks here. The router asserts (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'

/** One org's `GlRoleAssignment` row, exactly as stored. Callers filter in memory. */
export interface RoleAssignmentRecord {
  role: string
  glAccountId: string
  markedUnused: boolean
  /** The `FinancialSourceAccount` this row is scoped to (store axis), or null. */
  sourceAccountId: string | null
  /** The `payment_gateway` this row is scoped to (rail axis), or null. */
  paymentGatewayId: string | null
  /** Settlement currency; only a rail row may carry one. */
  currency: string | null
  source: string
  confirmedAt: Date | null
}

/** Every `GlRoleAssignment` row for one org, unfiltered - see the file header on why. */
export async function readRoleAssignments(
  db: Database | Transaction,
  organizationId: string
): Promise<RoleAssignmentRecord[]> {
  return db
    .select({
      role: schema.GlRoleAssignment.role,
      glAccountId: schema.GlRoleAssignment.glAccountId,
      markedUnused: schema.GlRoleAssignment.markedUnused,
      sourceAccountId: schema.GlRoleAssignment.sourceAccountId,
      paymentGatewayId: schema.GlRoleAssignment.paymentGatewayId,
      currency: schema.GlRoleAssignment.currency,
      source: schema.GlRoleAssignment.source,
      confirmedAt: schema.GlRoleAssignment.confirmedAt,
    })
    .from(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, organizationId))
}

/**
 * Insert org-default role rows, `ON CONFLICT DO NOTHING`, and answer how many
 * actually landed.
 *
 * 🛑 `GlRoleAssignment_org_role_key` became two PARTIAL indexes in task 47, so a
 * bare `(organizationId, role)` target no longer names one. `where` picks the
 * ORG DEFAULT half - the only half a seed or an import ever writes; a per-source
 * override is a human's decision, made in settings. ⚠️ BOTH null predicates:
 * task 58 widened the index predicate, and a narrower `where` infers no index at
 * all (42P10).
 *
 * `source` and NOT `confirmedAt`: `G19` leans on the difference between "we
 * chose this for you" and "you chose this".
 *
 * The caller owns the transaction and its {@link withAccountingCommitLock}.
 */
export async function insertDefaultRoleAssignmentsIfAbsent(
  tx: Transaction,
  organizationId: string,
  rows: readonly { role: string; glAccountId: string }[],
  source: 'seed' | 'import'
): Promise<number> {
  if (rows.length === 0) return 0
  const inserted = await tx
    .insert(schema.GlRoleAssignment)
    .values(
      rows.map((row) => ({ organizationId, role: row.role, glAccountId: row.glAccountId, source }))
    )
    .onConflictDoNothing({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
      where: and(
        isNull(schema.GlRoleAssignment.sourceAccountId),
        isNull(schema.GlRoleAssignment.paymentGatewayId)
      ),
    })
    .returning({ id: schema.GlRoleAssignment.id })
  return inserted.length
}
