// packages/lib/src/postings/role-assignments.ts

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
import { eq } from 'drizzle-orm'

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
