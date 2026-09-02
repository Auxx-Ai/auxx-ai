// packages/lib/src/seed/entity-migrations/migrations/122-order-shipping-and-note.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:122')

const ORDER_ENTITY_TYPE = 'order'

/**
 * The two fields this migration adds, by REGISTRY KEY (migration 119's rule): a later,
 * unrelated field on `order` cannot silently join this migration's payload.
 */
const NEW_FIELD_KEYS = ['shippingTotal', 'note'] as const

/**
 * Migration 122: order shipping and note
 * (plans/money/tasks/37-shopify-native-retarget.md §8/§10.1).
 *
 * ## What it adds
 *
 * Two fields on the existing `order` def — no new entity, no relationship to link:
 *
 *   order_shipping_total   CURRENCY, integer minor units, creatable/updatable — a STATED
 *                           header amount modelled on `purchase_order_shipping_total`, folded
 *                           into `order_total` by `computeDocumentTotals`'s new shipping term
 *                           (money/totals.ts) rather than derived from the lines.
 *   order_note             TEXT (multiline), creatable/updatable, nullable — a merchant's
 *                           delivery instruction, a fact that exists without any connector
 *                           (`D8`, §10.1).
 *
 * ## Why this is the Shopify retarget brief's ONE migration
 *
 * Everything else the brief needs — `order`, `line_item`, the totals engine, the connector
 * projection — already exists in all 28 orgs. Only these two fields are new, and both attach
 * to a def every org already has, so this is a straight `ensureCustomFields` call with no
 * `ensureEntityDefinitions` step and no `linkNewRelationships` pass (migration 121's Half 2 —
 * `vendor_part.purchaseUnit`/`purchaseRatio` — is the same shape).
 *
 * ## No backfill
 *
 * Both fields are nullable with no derivable default: an existing order has no shipping
 * amount to compute (the whole point of §6 is that Shopify's number is transcribed, never
 * derived) and no note to compose. Every existing row simply reads `null` until a human types
 * a note or a connector sync writes a shipping total, exactly like `purchase_order_notes` and
 * `purchase_order_shipping_total` behaved on the org that received THEM for the first time.
 *
 * Idempotent: `ensureCustomFields` is insert-only and skips a field that already exists, so a
 * re-run (or an org that reaches `order` only after this ships, and gets both fields from the
 * registry at seed time instead) is a no-op.
 */
export const migration122OrderShippingAndNote: EntityMigration = {
  id: '122-order-shipping-and-note',
  description: 'Add order_shipping_total and order_note to the existing order def',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // An org that has not reached `order` yet gets both fields from the registry at seed
    // time, the same way migration 119/121 skip an org that has not reached their target def.
    const orderDef = existing.entityDefs.get(ORDER_ENTITY_TYPE)
    if (!orderDef) return { ...state, alreadyUpToDate: true }

    const newFields: Record<string, ResourceField> = {}
    for (const key of NEW_FIELD_KEYS) {
      const field = ORDER_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make this
      // migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`order registry is missing the key "${key}" (migration 122)`)
      }
      newFields[key] = field
    }

    await ensureCustomFields(
      db,
      organizationId,
      ORDER_ENTITY_TYPE,
      orderDef.id,
      newFields,
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    // Invisible to every read path until the per-org caches that serve them are dropped.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 122 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
