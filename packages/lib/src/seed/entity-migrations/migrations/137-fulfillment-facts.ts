// packages/lib/src/seed/entity-migrations/migrations/137-fulfillment-facts.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:137')

/** The def the three fulfillment facts land on. Created by migration 107. */
const LINE_ITEM_ENTITY_TYPE = 'line_item'

/** The def the chart lives on. Created by migration 108. */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** The registry keys this migration adds. Their attributes are in the JSDoc below. */
const LINE_ITEM_KEYS = ['fulfilledAt', 'fulfilledQty', 'shipmentCount'] as const

/** The Affirm clearing account. `1210` is what a person recognises, not the name. */
const AFFIRM_CLEARING_CODE = '1210'

/**
 * `ACCOUNT_ROLES.CLEARING_AFFIRM`, as a literal.
 *
 * The constant is being added to `postings/build-entry.ts` in the same batch of
 * work, and a migration that imports a constant it landed alongside stops being
 * self-sufficient the moment somebody edits that constant: the STRING is what is
 * stored in `GlRoleAssignment.role`, and a stored string must never move because
 * an unrelated rename happened years later. `132-card-clearing-rename.ts` holds
 * its two role names the same way and for the same reason.
 */
const CLEARING_AFFIRM_ROLE = 'clearing_affirm'

/**
 * Migration 137: the sales channel's per-line fulfillment rollup, natively, and
 * the Affirm clearing role.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §8.4 decisions 4 and 6.
 *
 * ## What it adds
 *
 * - **`line_item_fulfilled_at`, `line_item_fulfilled_qty` and
 *   `line_item_shipment_count`** on `line_item`. Shopify already projects all
 *   three on every order sync, but until now they landed ONLY in
 *   `@app:shopify:*` app fields (49 §8.1 item 4), so **nothing native said an
 *   imported order had shipped** - and `money.fulfillOrder`, the one door into
 *   the ledger, was closed for 530 of the dev org's 545 orders (49 §1.2).
 *
 *   Native is the point, not a convenience. `deriveFulfillmentLog` (the sixth
 *   finalize pass) reconstructs `order_fulfillments` from these three fields and
 *   knows no Shopify field path at all, which is gap-f `G14`'s rule: the
 *   connector projects, lib reads native attributes. Measured on the dev org
 *   (49 §5): 82 of 538 imported orders ship in two shipments, no line spans two,
 *   and all 82 reconstruct by grouping lines on their fulfilled date.
 *
 * - **The `clearing_affirm` role on `1210 Affirm Clearing`**, whose role has
 *   been null since migration 108 created it. 11 of the dev org's orders pay
 *   through Affirm (49 §5), and an Affirm settlement never lands on the card
 *   rail - it is invisible to the payouts API - so folding those into `1200`
 *   would mean `1200` could never reconcile to zero (`default-chart.ts` says so
 *   at the account itself). One chart line, and the fulfillment builder's debit
 *   fork needs the role to exist before it can emit it.
 *
 * ## What it deliberately does NOT do
 *
 * 🛑 **No backfill of the three fields, and none is possible.** The values come
 * from the sales channel on the next sync after the connector bindings and the
 * org's mapping remap land, which is a change in a separate repo (49 §8.5). An
 * order that has already shipped carries no fulfilled date here until then, and
 * inventing one from `order_fulfillment_status` would date every shipment wrong
 * and post a year of revenue into one day.
 *
 * ⚠️ **It never repoints a role the org has already mapped**, and never touches
 * `1210` when some other role already resolves to it. That is chart rule 4
 * (`seed/gl-account-chart.ts`): a bookkeeper who mapped their own account keeps
 * it through every re-run. An org whose `clearing_affirm` is already assigned is
 * left exactly as it is.
 *
 * ## Ordering
 *
 * MUST sort after 107 (which creates `line_item`) and after 108 (which owns the
 * chart `1210` belongs to). An org short of either is a skip, not a failure -
 * it picks both up from the seeder with the rest of the registry.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips a field that
 * exists, and the role insert is guarded by a read and an
 * `ON CONFLICT DO NOTHING` on `(organizationId, role)`.
 */
export const migration137FulfillmentFacts: EntityMigration = {
  id: '137-fulfillment-facts',
  description:
    'Adds line_item_fulfilled_at, line_item_fulfilled_qty and line_item_shipment_count - the ' +
    "sales channel's per-line fulfillment rollup, carried natively so the fulfillment log " +
    'pass can reconstruct order_fulfillments for a connector order - and stamps the ' +
    'clearing_affirm role onto 1210 Affirm Clearing, whose role was null',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const lineItemDef = existing.entityDefs.get(LINE_ITEM_ENTITY_TYPE)
    if (lineItemDef) {
      await ensureCustomFields(
        db,
        organizationId,
        LINE_ITEM_ENTITY_TYPE,
        lineItemDef.id,
        pickLineItemFields(),
        existing,
        state
      )
    }

    const glAccountDefId = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)?.id
    const roleAssigned = glAccountDefId
      ? await assignAffirmClearingRole(db, organizationId, glAccountDefId)
      : false

    const changed = state.fieldsCreated > 0 || roleAssigned

    if (changed) {
      // A new field is invisible to every read path that serves it until the
      // per-org caches are dropped, and the role resolver reads `resources`.
      // `runEntityMigrationsForOrg` does this after the whole batch, but `up()`
      // can also be called directly (`scripts/run-entity-migration.ts`).
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 137 applied', { organizationId, ...state, roleAssigned })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * The three registry fields, loud if one was renamed.
 *
 * A silent skip here would ship a migration that reports success having created
 * nothing, and the pass that reads these attributes would then find no field and
 * derive no shipment log for any order - which reads as "this org has not synced
 * yet" rather than as a broken migration. The same guard 136's `pick` carries.
 */
function pickLineItemFields(): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of LINE_ITEM_KEYS) {
    const field = LINE_ITEM_FIELDS[key]
    if (!field) {
      throw new Error(`line_item registry is missing the key "${key}" (migration 137)`)
    }
    picked[key] = field
  }
  return picked
}

/**
 * Point `clearing_affirm` at the org's `1210`, and only when nothing has claimed
 * either side yet.
 *
 * Three guards, in order, each answering a different "leave it alone":
 *
 *  1. the org already has a `clearing_affirm` assignment - somebody, or a later
 *     re-seed, mapped it; this migration is done,
 *  2. the org has no `1210` - it renumbered its chart, and guessing which
 *     account is the Affirm one would post real money into it,
 *  3. `1210` already serves another role - "where its role is currently null"
 *     is the condition this migration was written under, and a second role on
 *     one account is legal but never something a migration should decide.
 *
 * @returns whether a row was written.
 */
async function assignAffirmClearingRole(
  db: Database,
  organizationId: string,
  glAccountDefId: string
): Promise<boolean> {
  const [alreadyAssigned] = await db
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.role, CLEARING_AFFIRM_ROLE)
      )
    )
    .limit(1)
  if (alreadyAssigned) return false

  const [codeField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.entityDefinitionId, glAccountDefId),
        eq(schema.CustomField.systemAttribute, 'gl_account_code')
      )
    )
    .limit(1)
  if (!codeField) return false

  const [account] = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeField.id),
        eq(schema.FieldValue.valueText, AFFIRM_CLEARING_CODE)
      )
    )
    .limit(1)
  if (!account) return false

  const [otherRole] = await db
    .select({ role: schema.GlRoleAssignment.role })
    .from(schema.GlRoleAssignment)
    .where(
      and(
        eq(schema.GlRoleAssignment.organizationId, organizationId),
        eq(schema.GlRoleAssignment.glAccountId, account.entityId)
      )
    )
    .limit(1)
  if (otherRole) {
    logger.warn('Migration 137 left 1210 alone - it already serves a role', {
      organizationId,
      role: otherRole.role,
    })
    return false
  }

  // `source: 'seed'` and NOT `confirmedAt`: auxx chose this, the bookkeeper has
  // not confirmed it, and the setup wizard renders the two differently (`G19`).
  const inserted = await db
    .insert(schema.GlRoleAssignment)
    .values({
      organizationId,
      role: CLEARING_AFFIRM_ROLE,
      glAccountId: account.entityId,
      source: 'seed',
    })
    .onConflictDoNothing({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
    })
    .returning({ id: schema.GlRoleAssignment.id })

  return inserted.length > 0
}
