// packages/lib/src/seed/entity-migrations/migrations/145-retire-instance-roles.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { BANK_ACCOUNT_FIELDS } from '../../../resources/registry/resources/bank-account-fields'
import { PAYOUT_FIELDS } from '../../../resources/registry/resources/payout-fields'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:145')

const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const BANK_ACCOUNT_ENTITY_TYPE = 'bank_account'
const PAYOUT_ENTITY_TYPE = 'payout'

/** Roles brief 13 §2 retires outright: a bank account is not a role. */
const RETIRED_ROLES = ['cash', 'revenue_dealer'] as const

/** The channel role folded into the single product-revenue role (brief 13 §5). */
const OLD_REVENUE_ROLE = 'revenue_dtc'
const NEW_REVENUE_ROLE = 'revenue_product'

/**
 * The name to replace, and only this one - a bookkeeper who already renamed
 * the account keeps their name (chart rule 3, the same guard `132` uses for
 * `1200 Shopify Clearing`).
 */
const OLD_PAYROLL_CLEARING_NAME = 'Payroll Clearing (ADP)'
const NEW_PAYROLL_CLEARING_NAME = 'Payroll Clearing'

/** A moved role, a renamed account or a new field are all invisible until this drops. */
const CACHE_KEYS = ['resources', 'customFields'] as const

/**
 * Migration 145: retires the instance-shaped roles `13` §2 and §5 argue
 * against, and provisions the three fields their replacements need.
 *
 * `plans/accounting/tasks/13-cash-accounts-and-the-qbo-seam.md` §2, §5.
 *
 * ## What it does, per org, in order
 *
 * (a) **Deletes** every `GlRoleAssignment` row whose `role` is `cash` or
 *     `revenue_dealer`. Neither survives as a role: `cash` because a bank
 *     account is an instance, several of which an org holds, never a
 *     function one role can name; `revenue_dealer` because the channel it
 *     named is now a `dimensions.channel` value on the line, folded into
 *     {@link NEW_REVENUE_ROLE} by (b) below. Deleting rather than repointing
 *     is correct here because nothing replaces `cash` as a role at all - the
 *     builders that used to emit it now carry a `bank_account`'s own
 *     `glAccountId` directly, and a `GlRoleAssignment` row for a role no
 *     builder emits is not a mapping, it is debris a role-map screen would
 *     render forever.
 * (b) **Moves** `revenue_dtc` to `revenue_product`, in place - the account the
 *     assignment points at is unchanged, only the role name is, mirroring
 *     `132-card-clearing-rename.ts`'s `moveRole`. When an org already holds a
 *     `revenue_product` row (a fresh seed ran after this shipped, or a
 *     previous partial run of this migration already moved it), the stale
 *     `revenue_dtc` row is DELETED instead of renamed, because
 *     `GlRoleAssignment` is uniquely indexed on `(organizationId, role)` and
 *     the rename would collide.
 * (c) **Renames** every non-archived `gl_account` whose `gl_account_name` is
 *     EXACTLY `"Payroll Clearing (ADP)"` to `"Payroll Clearing"` - the same
 *     provider-in-the-name defect entity migration 132 fixed for `1200`
 *     (`default-chart.ts`'s own header on `2110`). The code and the role
 *     (`payroll_clearing`) do not move; only the label does, and only when it
 *     still reads exactly the old default.
 * (d) **Provisions** the three fields the new posting shape reads: a nullable
 *     `bank_account.stripeExternalAccountId` (the confirmed Stripe
 *     destination identity, brief 13 §2.3), and nullable
 *     `payout.destination` / `payout.blockedReason` (the gateway's own
 *     destination id, and the sentence a payout carries when it cannot be
 *     resolved to one). `ensureCustomFields` creates whichever of the three
 *     is missing and leaves the rest alone - a fresh org that ran the
 *     registry after this shipped already has them all.
 *
 * ## What it deliberately does NOT touch
 *
 * **Posted `GlPostingLine` rows.** `accountRole` and `accountName` on an
 * already-posted line are SNAPSHOTS, the same rule `132`'s header states for
 * `clearing_shopify` / `"Shopify Clearing"`: an entry posted under
 * `revenue_dtc` keeps saying `revenue_dtc` in the register forever, because
 * rewriting history the moment a vocabulary moves is exactly the thing a
 * snapshot exists to prevent. Nothing reads those columns to resolve an
 * account - `resolveRoles` goes through `GlRoleAssignment` alone - so the
 * stale strings cost nothing but literal accuracy about a name that has since
 * moved on.
 *
 * ## Self-sufficient and idempotent
 *
 * Every write is narrowed to rows that still need it, so a re-run reports
 * `alreadyUpToDate: true`. Verified by `SELECT` over more than one org, never
 * by the log - see the migration's own test and the report this task owes.
 * Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 145-retire-instance-roles`.
 */
export const migration145RetireInstanceRoles: EntityMigration = {
  id: '145-retire-instance-roles',
  description:
    'Deletes the cash and revenue_dealer role assignments, moves revenue_dtc onto ' +
    'revenue_product, renames "Payroll Clearing (ADP)" to "Payroll Clearing", and provisions ' +
    'bank_account.stripeExternalAccountId / payout.destination / payout.blockedReason ' +
    '(brief 13 §2, §5)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const rolesDeleted = await deleteRetiredRoles(db, organizationId)
    const revenueMoved = await moveRevenueDtcRole(db, organizationId)
    const accountsRenamed = await renamePayrollClearing(db, organizationId, existing)
    const fieldsCreated = await ensureNewFields(db, organizationId, existing, state)

    const changed = rolesDeleted > 0 || revenueMoved > 0 || accountsRenamed > 0 || fieldsCreated > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 145 applied', {
        organizationId,
        rolesDeleted,
        revenueMoved,
        accountsRenamed,
        fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/** Delete every `GlRoleAssignment` row naming a role brief 13 §2 retires outright. */
async function deleteRetiredRoles(db: Database, organizationId: string): Promise<number> {
  const deleted = await db
    .delete(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        inArray(schema.GlRoleAssignment.role, [...RETIRED_ROLES])
      )
    )
    .returning({ id: schema.GlRoleAssignment.id })
  return deleted.length
}

/**
 * Move the `revenue_dtc` assignment onto `revenue_product`, keeping the
 * account it points at - mirrors `132-card-clearing-rename.ts`'s `moveRole`.
 * Returns how many rows changed (0 or 1).
 */
async function moveRevenueDtcRole(db: Database, organizationId: string): Promise<number> {
  const [old] = await db
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, OLD_REVENUE_ROLE)
      )
    )
    .limit(1)
  if (!old) return 0

  const [already] = await db
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, NEW_REVENUE_ROLE)
      )
    )
    .limit(1)

  // 🛑 `(organizationId, role)` is uniquely indexed, so renaming onto a row
  // that already exists would throw. The new row is the authority; the old
  // one is a leftover nothing resolves any more.
  if (already) {
    await db.delete(schema.GlRoleAssignment).where(eq(schema.GlRoleAssignment.id, old.id))
    return 1
  }

  await db
    .update(schema.GlRoleAssignment)
    .set({ role: NEW_REVENUE_ROLE })
    .where(eq(schema.GlRoleAssignment.id, old.id))
  return 1
}

/**
 * Rename every non-archived `gl_account` whose name is exactly
 * `"Payroll Clearing (ADP)"` to `"Payroll Clearing"`. The code and the role
 * are untouched - only the label moves, and only when it still reads exactly
 * the old default (chart rule 3).
 */
async function renamePayrollClearing(
  db: Database,
  organizationId: string,
  existing: Awaited<ReturnType<typeof loadExistingState>>
): Promise<number> {
  const glAccountDef = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
  if (!glAccountDef) return 0

  const nameFieldId = existing.fields.get(fieldKey(glAccountDef.id, 'gl_account_name'))?.id
  if (!nameFieldId) return 0

  const matches = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, nameFieldId),
        eq(schema.FieldValue.valueText, OLD_PAYROLL_CLEARING_NAME)
      )
    )
  if (matches.length === 0) return 0

  const updated = await db
    .update(schema.FieldValue)
    .set({ valueText: NEW_PAYROLL_CLEARING_NAME, updatedAt: new Date() })
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, nameFieldId),
        inArray(
          schema.FieldValue.entityId,
          matches.map((row) => row.entityId)
        ),
        eq(schema.FieldValue.valueText, OLD_PAYROLL_CLEARING_NAME)
      )
    )
    .returning({ id: schema.FieldValue.id })

  return updated.length
}

/**
 * `ensureCustomFields` for the three new fields, on whichever of `bank_account`
 * / `payout` already exists in this org. An org short of either def has
 * nothing to provision yet - it picks the fields up when the def itself is
 * created (migrations 125, 133).
 */
async function ensureNewFields(
  db: Database,
  organizationId: string,
  existing: Awaited<ReturnType<typeof loadExistingState>>,
  state: { entityDefsCreated: number; fieldsCreated: number; relationshipsLinked: number }
): Promise<number> {
  const before = state.fieldsCreated

  const bankAccountDef = existing.entityDefs.get(BANK_ACCOUNT_ENTITY_TYPE)
  if (bankAccountDef) {
    const stripeExternalAccountId = BANK_ACCOUNT_FIELDS.stripeExternalAccountId
    if (!stripeExternalAccountId) {
      throw new Error(
        "bank-account-fields registry is missing the key 'stripeExternalAccountId' (migration 145)"
      )
    }
    await ensureCustomFields(
      db,
      organizationId,
      BANK_ACCOUNT_ENTITY_TYPE,
      bankAccountDef.id,
      { stripeExternalAccountId },
      existing,
      state
    )
  }

  const payoutDef = existing.entityDefs.get(PAYOUT_ENTITY_TYPE)
  if (payoutDef) {
    const destination = PAYOUT_FIELDS.destination
    const blockedReason = PAYOUT_FIELDS.blockedReason
    if (!destination || !blockedReason) {
      throw new Error(
        "payout-fields registry is missing 'destination' or 'blockedReason' (migration 145)"
      )
    }
    await ensureCustomFields(
      db,
      organizationId,
      PAYOUT_ENTITY_TYPE,
      payoutDef.id,
      { destination, blockedReason },
      existing,
      state
    )
  }

  return state.fieldsCreated - before
}
