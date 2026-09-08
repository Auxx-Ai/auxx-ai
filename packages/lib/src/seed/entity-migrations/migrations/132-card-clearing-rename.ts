// packages/lib/src/seed/entity-migrations/migrations/132-card-clearing-rename.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:132')

/** The def the chart lives on. Created by migration 108. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** The account being renamed. Unchanged by this migration - only its name is. */
const CLEARING_CODE = '1200'

/** The role as it was, and as it now is. */
const OLD_ROLE = 'clearing_shopify'
const NEW_ROLE = 'clearing_card'

/**
 * The name to replace, and only this one. A bookkeeper who already renamed the
 * account keeps their name - chart rule 3 (`seed/gl-account-chart.ts`).
 */
const OLD_NAME = 'Shopify Clearing'
const NEW_NAME = 'Card Clearing'

/** A renamed account and a moved role are both invisible until this is dropped. */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 132: `1200 Shopify Clearing` becomes `1200 Card Clearing`, and its
 * role `clearing_shopify` becomes `clearing_card`.
 *
 * ## Why
 *
 * The account was named for a provider whose money never touches it.
 * `PaymentTransaction.provider` is `'manual' | 'stripe'` and **there is no
 * Shopify payment rail in auxx at all**, while `DEFAULT_PAYMENT_ROUTES.card` is
 * `clearing`, which `PAYMENT_ROUTE_ROLE` mapped to `clearing_shopify`. So every
 * Stripe card receipt was accumulating in an account named Shopify. It
 * reconciled perfectly and read as a lie, which is the worst kind of wrong a
 * chart of accounts can be: nothing fails, and a bookkeeper draws the wrong
 * conclusion.
 *
 * The code is untouched. `1200` is what a person recognises and what
 * `GlPostingLine.accountCode` froze onto every line already posted.
 *
 * ## 🛑 What is deliberately NOT rewritten
 *
 * **Posted lines keep `accountRole: 'clearing_shopify'` and
 * `accountName: 'Shopify Clearing'`.** Both columns are SNAPSHOTS, by the same
 * rule that governs a movement's frozen cost: `GlPostingLine.accountName`'s own
 * doc says renaming an account next year must not rewrite last year's ledger,
 * and `accountRole` exists so a line can answer *which account was this
 * SUPPOSED to be* as the chart moves under it. Rewriting them would destroy the
 * only record that the entry was posted under the old vocabulary.
 *
 * Nothing reads those columns to resolve an account - `resolveRoles` goes
 * through `GlRoleAssignment` - so the stale strings cost nothing but honesty.
 *
 * ## Self-sufficient
 *
 * The role move is a rename in place, never a repoint: the assignment keeps
 * pointing at the same account id, so no posting changes where it lands. An org
 * that already carries `clearing_card` (a fresh seed ran after this shipped)
 * has its stale `clearing_shopify` row DELETED rather than renamed, because
 * `GlRoleAssignment` is uniquely indexed on `(organizationId, role)` and the
 * rename would collide.
 *
 * An org short of migration 108 has no chart at all and is a skip - it will
 * pick `1200 Card Clearing` up from 108 itself, already correctly named.
 */
export const migration132CardClearingRename: EntityMigration = {
  id: '132-card-clearing-rename',
  description:
    'Renames 1200 Shopify Clearing to Card Clearing and its clearing_shopify role to ' +
    'clearing_card - there is no Shopify payment rail in auxx, so the Stripe money sitting ' +
    'in it was in an account named for a provider it never touched',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)
    const def = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    if (!def) return { ...state, alreadyUpToDate: true }

    const rolesMoved = await moveRole(db, organizationId)
    const renamed = await renameAccount(db, organizationId, def.id)
    const changed = rolesMoved > 0 || renamed

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 132 applied', { organizationId, rolesMoved, renamed })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Move the assignment from the old role name to the new one, keeping the
 * account it points at. Returns how many rows moved (0 or 1).
 */
async function moveRole(db: Database, organizationId: string): Promise<number> {
  const [old] = await db
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, OLD_ROLE)
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
        eq(schema.GlRoleAssignment.role, NEW_ROLE)
      )
    )
    .limit(1)

  // 🛑 `(organizationId, role)` is uniquely indexed, so renaming onto a row that
  // already exists would throw. The new row is the authority; the old one is a
  // leftover that nothing resolves any more.
  if (already) {
    await db.delete(schema.GlRoleAssignment).where(eq(schema.GlRoleAssignment.id, old.id))
    return 1
  }

  await db
    .update(schema.GlRoleAssignment)
    .set({ role: NEW_ROLE })
    .where(eq(schema.GlRoleAssignment.id, old.id))
  return 1
}

/**
 * Rename `1200` from the old default name to the new one, and ONLY when it
 * still reads exactly the old default. Returns whether a row was written.
 */
async function renameAccount(
  db: Database,
  organizationId: string,
  glAccountDefId: string
): Promise<boolean> {
  const fields = await db
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, glAccountDefId))

  const codeFieldId = fields.find((f) => f.systemAttribute === 'gl_account_code')?.id
  const nameFieldId = fields.find((f) => f.systemAttribute === 'gl_account_name')?.id
  if (!codeFieldId || !nameFieldId) return false

  const [account] = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeFieldId),
        eq(schema.FieldValue.valueText, CLEARING_CODE)
      )
    )
    .limit(1)
  if (!account) return false

  // The `valueText` predicate is what keeps chart rule 3: an org that renamed
  // this account matches nothing and is left exactly as it is.
  const updated = await db
    .update(schema.FieldValue)
    .set({ valueText: NEW_NAME, updatedAt: new Date() })
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, nameFieldId),
        eq(schema.FieldValue.entityId, account.entityId),
        eq(schema.FieldValue.valueText, OLD_NAME)
      )
    )
    .returning({ id: schema.FieldValue.id })

  return updated.length > 0
}
