// packages/lib/src/data-migrations/migrations/157-payout-rail-and-order-payment-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { BANK_ACCOUNT_FIELDS } from '../../resources/registry/resources/bank-account-fields'
import { LINE_ITEM_FIELDS } from '../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../resources/registry/resources/order-fields'
import { PAYMENT_GATEWAY_FIELDS } from '../../resources/registry/resources/payment-gateway-fields'
import { PAYOUT_FIELDS } from '../../resources/registry/resources/payout-fields'
import {
  ensureCustomFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:157')

const PAYOUT_ENTITY_TYPE = 'payout'
const PAYMENT_GATEWAY_ENTITY_TYPE = 'payment_gateway'
const BANK_ACCOUNT_ENTITY_TYPE = 'bank_account'
const ORDER_ENTITY_TYPE = 'order'
const LINE_ITEM_ENTITY_TYPE = 'line_item'

/**
 * The attribute this migration stamps a value on.
 *
 * Held as a LITERAL for the reason 156, 155 and 150 hold theirs: this is the
 * value the migration matches stored rows on, not a reference to whatever the
 * registry constant is renamed to later. The field DEFINITIONS below are
 * resolved out of the registry, because those must never drift.
 */
const SOURCE_ATTRIBUTE = 'payout_source'

/**
 * The value every pre-existing payout is stamped with.
 *
 * A literal, not an import from the registry enum. Every payout written before
 * this field existed came from the Stripe sync, the only writer there has ever
 * been; if the vocabulary's default ever changes, the rows this migration
 * already wrote must not retroactively change with it.
 */
const SYNCED = 'synced'

/**
 * The registry keys this migration provisions on `payout`, in panel order.
 *
 * Named as KEYS and resolved out of {@link PAYOUT_FIELDS} rather than restated
 * here, so a stored field can never disagree with the one a fresh org is seeded
 * with. The keys themselves are checked, because a rename in the registry with
 * no rename here would otherwise create two fields while claiming three and say
 * nothing.
 */
const NEW_PAYOUT_FIELD_KEYS = ['paymentGateway', 'bankAccount', 'source'] as const

/**
 * The registry keys this migration provisions on `order`, resolved out of
 * {@link ORDER_FIELDS} for the same reason and checked the same way.
 *
 * `paymentGlPosting` (`order_payment_gl_posting`) was here too, until step 1b
 * (TARGET §1) retired the stamp field: an order's payment postings are read
 * through `listPostingsForSource` now. This migration is local-only (§0b), so
 * it is edited in place rather than left with a removal migration of its own.
 */
const NEW_ORDER_FIELD_KEYS = ['paidAt', 'paidGateway'] as const

/**
 * The registry key this migration provisions on `line_item`, resolved out of
 * {@link LINE_ITEM_FIELDS} and checked the same way.
 */
const NEW_LINE_ITEM_FIELD_KEYS = ['netTotal'] as const

/**
 * Every relationship half this migration must LINK, paired with the inverse it
 * points at. Checked explicitly after {@link linkNewRelationships} rather than
 * trusted, because that helper only logs a DEBUG line when it cannot resolve an
 * inverse (the 135 lesson, restated by 149 and 153). An UNLINKED relationship
 * is worse than a missing one: the sync's write is accepted, and the pair
 * lookup in `findPayoutByGatewayId` reads an empty cell forever.
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  {
    owning: `payout:${PAYOUT_FIELDS.paymentGateway?.id}`,
    inverse: 'payment_gateway:payouts',
  },
  {
    owning: `payment_gateway:${PAYMENT_GATEWAY_FIELDS.payouts?.id}`,
    inverse: 'payout:paymentGateway',
  },
  { owning: `payout:${PAYOUT_FIELDS.bankAccount?.id}`, inverse: 'bank_account:payouts' },
  { owning: `bank_account:${BANK_ACCOUNT_FIELDS.payouts?.id}`, inverse: 'payout:bankAccount' },
]

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

type ExistingState = Awaited<ReturnType<typeof loadExistingState>>
type CreatedState = Pick<
  PerOrgMigrationResult,
  'entityDefsCreated' | 'fieldsCreated' | 'relationshipsLinked'
>
type EnsuredField =
  Awaited<ReturnType<typeof ensureCustomFields>> extends Map<string, infer V> ? V : never

/**
 * Migration 157: a `payout` learns WHICH rail it settled, WHICH bank account it
 * landed in and WHERE the record came from
 * (`plans/accounting/tasks/27-a-settlement-from-anywhere.md` §6.1, brief 27
 * unit 1), and an `order` learns WHICH posting its payment entry became, WHEN
 * the customer paid and THROUGH WHICH gateway
 * (`plans/accounting/tasks/29-clearing-at-the-payment-date.md` §3.1, §4.3,
 * brief 29 unit 1), and a `line_item` learns its NET total after every
 * allocated discount (29 §2.3, MK's 2026-09-14 decision on where the net lives).
 *
 * This file supersedes two same-day drafts, `157-payout-rail-and-source` and
 * `158-order-payment-stamp-and-paid-fields`, merged because both were written
 * on 2026-09-14 and neither had shipped. The dev worker auto-applies pending
 * migrations on boot, so the payout half MAY meet an org where 157's first
 * draft already ran: its fields, option lists and inverses in place and every
 * payout already stamped. That half is a true no-op there, and the order and
 * line item halves still land their fields. Nothing here ever rewrites a stored
 * value.
 *
 * ## What it adds to `payout`
 *
 * - **`payout_payment_gateway`**, a RELATIONSHIP to `payment_gateway`, with its
 *   `payment_gateway_payouts` inverse. The routing key: the source stamps the
 *   rail it read for, and the idempotency check becomes the PAIR
 *   (`payment_gateway`, `payout_gateway_id`) rather than the gateway id alone,
 *   because two providers can reuse an id format and a CSV row and an API read
 *   of one payout must be one row (27 §6.4).
 * - **`payout_bank_account`**, a RELATIONSHIP to `bank_account`, with its
 *   `bank_account_payouts` inverse. `payout_destination` is a Stripe
 *   external-account id only a Stripe resolver can read; every other source
 *   names the account directly, and this is where the resolved answer lives.
 * - **`payout_source`**, a SINGLE_SELECT of `synced` | `imported`. Provenance
 *   on screen, and the rule a future API source obeys when it meets a row a
 *   statement import made first.
 *
 * ## What it adds to `order`
 *
 * `order_payment_gl_posting` was here too - it no longer is; see
 * {@link NEW_ORDER_FIELD_KEYS}.
 *
 * - **`order_paid_at`**, DATETIME, the `processed_at` of the order's successful
 *   `sale` or `capture` transaction. The payment entry's date for a terms order
 *   that pays after it was placed.
 * - **`order_paid_gateway`**, TEXT, that transaction's `gateway`.
 *   `order_payment_gateways` also lists gateways from FAILED attempts, so the
 *   clearing fork reads this when present and falls back to the single-gateway
 *   rule when not.
 *
 * ## What it adds to `line_item`
 *
 * - **`line_item_net_total`**, CURRENCY, "Line total after discount". The line
 *   NET: `line_item_line_total` minus every discount allocated to the line.
 *   `line_item_unit_price` and `line_item_line_total` stay GROSS (`qty x unit
 *   price`, what Shopify's admin shows per line and what a customer expects to
 *   match), and the allocated net lives here instead: the totals engine writes
 *   it for a native order (the header discount pushed down pro rata) and the
 *   connector writes it for a synced one (`price x qty - Σ discount_allocations`).
 *   The ledger recognises revenue at this column and falls back to
 *   `line_item_line_total` when it is null (29 §2.3). Hidden from the panel and
 *   the dialogs; an optional records-table column.
 *
 *   **No value backfill, on purpose.** The column is filled by its writers on
 *   their next write: the totals engine on the next recompute of a native order
 *   (any qty, price, discount or line write triggers one), and the connector on
 *   the per-org remap that 29 unit 7 runs after this migration. Until then the
 *   ledger's fallback reads `line_item_line_total`, which for a synced order
 *   still holds the net the connector used to write there, so nothing posts a
 *   different number before the remap flips that column to gross.
 *
 * ## Why a migration and not just the registry edit
 *
 * `EntityDefinition` and `CustomField` rows are seeded per org from the
 * resource registry, and `ensureCustomFields` is INSERT-only, so a registry
 * edit reaches FRESH orgs and nothing else. Without it, every existing org's
 * connector binding onto `order_paid_at` resolves no field id and writes
 * nothing, and the totals
 * engine's net write onto `line_item_net_total` is skipped for want of a field
 * id (so the ledger falls back to the gross total forever). Worse for the two
 * payout relationships: both halves have to land in ONE field map for
 * `linkNewRelationships` to resolve either inverse, which is why the payout
 * half widens three defs in one pass rather than one per def. And worse again
 * for the SINGLE_SELECT: it renders BLANK, with no options at all, until its
 * option list is written onto the row; `ensureCustomFields` builds `options`
 * from the registry field, so the list arrives with the field.
 *
 * ## Why the payout half STAMPS `synced` rather than leaving null
 *
 * Every payout that exists today was written by the Stripe sync. Leaving the
 * cell empty would make the read path the only thing holding that answer, and
 * the payouts page would show a blank provenance over rows whose provenance is
 * perfectly well known. Writing the row makes the record say what it is, the
 * same argument 156 made for `netted`.
 *
 * The two relationships are NOT backfilled. Which rail an old payout settled is
 * knowable only by re-running the resolver against today's gateway records,
 * and a record that was created or re-pointed since would put yesterday's
 * payout on today's rail. The sync adopts an unstamped row the next time it
 * sees that payout (its pair lookup accepts a null pointer, see
 * `findPayoutByGatewayId`) and stamps the rail it resolves then, which is the
 * moment the answer is actually known.
 *
 * ## Why the order half has NO backfill, and none is possible
 *
 * Nothing is stamped on `order`. The paid date of an existing order is not
 * knowable from anything the platform holds: `RawOrder` carries
 * `processed_at`, `financial_status` and the gateway NAME LIST, not the
 * transactions (29 §1.4), and the platform has never fetched them. Writing
 * `order_placed_at` into `order_paid_at` would be right for an order paid at
 * checkout and WRONG for every terms order, with nothing in the row to tell
 * the two apart, so the payment entry reads `order_paid_at` when present and
 * falls back to `order_placed_at` itself (29 §3), and the connector fills the
 * field on its next sync once 29 unit 7 lands. The stamp has no history to
 * backfill: no `order_payment` entry has ever been posted, because the type
 * does not exist until 29 unit 2.
 *
 * ## Self-sufficient: the one backfill is inline
 *
 * The payout stamp is in this file, in the same `up()`, and depends on no other
 * migration having run. One SELECT for the instances, one for the values
 * already present, one INSERT for the difference. Never a per-row loop.
 *
 * The option key goes in `FieldValue.optionId`, not `valueText`. That is what
 * the payout read path (`resolvePayoutSource` in `money/payouts/reads.ts`)
 * reads and the single column the CRUD handler writes for a select.
 *
 * **No DDL.** This writes `CustomField` and `FieldValue` rows; nothing here
 * touches a Postgres table.
 *
 * ## Ordering and idempotency
 *
 * Each half skips on its own. An org short of any of the three payout-side
 * defs (`payout` from 133, `bank_account` from 125, `payment_gateway` from 146)
 * skips the payout half; an org with no `order` def skips the order half; an
 * org with no `line_item` def skips the line item half. A skip is not a
 * failure: a fresh install brings every def and all of their fields together
 * from the registry, and a half that skips must not stop the others from
 * landing.
 *
 * Re-running writes nothing. `ensureCustomFields` is INSERT-only,
 * `linkNewRelationships` only fills a null inverse, and the stamp excludes
 * every instance that already holds a `payout_source` value. Safe to re-apply
 * with `packages/lib/scripts/run-entity-migration.ts --id
 * 157-payout-rail-and-order-payment-fields`.
 */
export const migration157PayoutRailAndOrderPaymentFields: PerOrgMigration = {
  id: '157-payout-rail-and-order-payment-fields',
  description:
    'Adds payout.paymentGateway and payout.bankAccount (relationships, with their ' +
    'payment_gateway.payouts and bank_account.payouts inverses) and payout.source ' +
    '(synced | imported), and stamps synced on every existing payout record - the Stripe sync ' +
    'was the only writer there has ever been; the rail is the routing key and half of the ' +
    'idempotency pair (plans/accounting/tasks/27-a-settlement-from-anywhere.md §6.1, §6.4). ' +
    'Also adds order.paidAt and order.paidGateway (the ' +
    'successful sale or capture transaction, connector-written). No backfill for the order ' +
    'fields: the paid date of an existing order is not knowable from anything the platform ' +
    'holds (plans/accounting/tasks/29-clearing-at-the-payment-date.md §3.1, §4.3). Also adds ' +
    'line_item.netTotal (the line NET after every allocated discount; unit_price and ' +
    'line_total stay gross), filled by the totals engine and the connector on their next ' +
    'write, never backfilled here (29 §2.3)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state: CreatedState = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const stamped = await widenPayout(db, organizationId, existing, state)
    await widenOrder(db, organizationId, existing, state)
    await widenLineItem(db, organizationId, existing, state)

    const changed = state.fieldsCreated > 0 || state.relationshipsLinked > 0 || stamped > 0
    if (changed) {
      // `ensureCustomFields`, `linkNewRelationships` and the direct `FieldValue`
      // insert all bypass the org cache, and every renderer and every read
      // resolves a field's shape from it - a stale entry would keep dropping
      // writes to these fields. `perOrgMigration` flushes after the whole
      // batch, but `up()` is also called directly by
      // `scripts/run-entity-migration.ts`, so do it here too (as 153 and 156 do).
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 157 applied', { organizationId, ...state, stamped })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * The payout half: three fields on `payout`, one inverse each on
 * `payment_gateway` and `bank_account`, and `synced` stamped onto every payout
 * that has no source yet. Answers how many payouts were stamped, 0 when the
 * half skipped because a def is missing.
 */
async function widenPayout(
  db: Database,
  organizationId: string,
  existing: ExistingState,
  state: CreatedState
): Promise<number> {
  const payoutDef = existing.entityDefs.get(PAYOUT_ENTITY_TYPE)
  const gatewayDef = existing.entityDefs.get(PAYMENT_GATEWAY_ENTITY_TYPE)
  const bankAccountDef = existing.entityDefs.get(BANK_ACCOUNT_ENTITY_TYPE)
  if (!payoutDef || !gatewayDef || !bankAccountDef) {
    // Absent rather than failed: an org short of any of these has not been
    // seeded from the current registry at all, and the seeder creates
    // everything below together from it.
    return 0
  }

  const payoutFields: Record<string, ResourceField> = {}
  for (const key of NEW_PAYOUT_FIELD_KEYS) {
    const field = PAYOUT_FIELDS[key]
    if (!field) {
      throw new Error(`payout-fields registry is missing the key "${key}" (migration 157)`)
    }
    payoutFields[key] = field
  }
  const gatewayPayouts = PAYMENT_GATEWAY_FIELDS.payouts
  const bankAccountPayouts = BANK_ACCOUNT_FIELDS.payouts
  if (!gatewayPayouts || !bankAccountPayouts) {
    throw new Error(
      'registry is missing payment_gateway.payouts or bank_account.payouts (migration 157)'
    )
  }

  const entityDefIds = new Map<string, string>([
    [PAYOUT_ENTITY_TYPE, payoutDef.id],
    [PAYMENT_GATEWAY_ENTITY_TYPE, gatewayDef.id],
    [BANK_ACCOUNT_ENTITY_TYPE, bankAccountDef.id],
  ])

  // ONE field map spanning all three defs. `linkNewRelationships` resolves an
  // inverse out of this map by `<entityType>:<field id>`, so linking the halves
  // of a pair from separate maps would leave each unable to see the other and
  // skip the pair with nothing louder than a debug line.
  const fieldMap = new Map<string, EnsuredField>()
  const widen = async (
    entityType: string,
    defId: string,
    fields: Record<string, ResourceField>
  ) => {
    // The RETURN value, not the `existing` snapshot: on a first run the rows
    // are created inside this call, and the snapshot does not hold them.
    const created = await ensureCustomFields(
      db,
      organizationId,
      entityType,
      defId,
      fields,
      existing,
      state
    )
    for (const [key, value] of created) fieldMap.set(key, value)
  }
  await widen(PAYOUT_ENTITY_TYPE, payoutDef.id, payoutFields)
  await widen(PAYMENT_GATEWAY_ENTITY_TYPE, gatewayDef.id, { payouts: gatewayPayouts })
  await widen(BANK_ACCOUNT_ENTITY_TYPE, bankAccountDef.id, { payouts: bankAccountPayouts })

  await linkNewRelationships(db, fieldMap, entityDefIds, state)
  await assertInversesLinked(db, fieldMap)

  const sourceFieldId = [...fieldMap.values()].find(
    (field) => field.systemAttribute === SOURCE_ATTRIBUTE
  )?.id
  if (!sourceFieldId) {
    throw new Error(`Migration 157 resolved no ${SOURCE_ATTRIBUTE} field for org ${organizationId}`)
  }

  return stampSynced(db, organizationId, payoutDef.id, sourceFieldId)
}

/**
 * The order half: three fields on `order`, nothing stamped. Skips when the org
 * has no `order` def.
 */
async function widenOrder(
  db: Database,
  organizationId: string,
  existing: ExistingState,
  state: CreatedState
): Promise<void> {
  const orderDef = existing.entityDefs.get(ORDER_ENTITY_TYPE)
  if (!orderDef) {
    // Absent rather than failed: an org with no `order` def has not been
    // seeded from the current registry at all, and the seeder creates the def
    // and these fields together from it.
    return
  }

  const orderFields: Record<string, ResourceField> = {}
  for (const key of NEW_ORDER_FIELD_KEYS) {
    const field = ORDER_FIELDS[key]
    if (!field) {
      throw new Error(`order-fields registry is missing the key "${key}" (migration 157)`)
    }
    orderFields[key] = field
  }

  await ensureCustomFields(
    db,
    organizationId,
    ORDER_ENTITY_TYPE,
    orderDef.id,
    orderFields,
    existing,
    state
  )
}

/**
 * The line item half: one field on `line_item`, nothing stamped. Skips when the
 * org has no `line_item` def. The value arrives from the totals engine and the
 * connector on their next write; see the header for why no backfill is right.
 */
async function widenLineItem(
  db: Database,
  organizationId: string,
  existing: ExistingState,
  state: CreatedState
): Promise<void> {
  const lineItemDef = existing.entityDefs.get(LINE_ITEM_ENTITY_TYPE)
  if (!lineItemDef) return

  const lineItemFields: Record<string, ResourceField> = {}
  for (const key of NEW_LINE_ITEM_FIELD_KEYS) {
    const field = LINE_ITEM_FIELDS[key]
    if (!field) {
      throw new Error(`line-item-fields registry is missing the key "${key}" (migration 157)`)
    }
    lineItemFields[key] = field
  }

  await ensureCustomFields(
    db,
    organizationId,
    LINE_ITEM_ENTITY_TYPE,
    lineItemDef.id,
    lineItemFields,
    existing,
    state
  )
}

/**
 * Fail loudly when a relationship half was created but never linked.
 *
 * `linkNewRelationships` skips an unresolvable inverse with a debug line, which
 * here would mean a `payout` that accepts a gateway pointer nobody can read
 * back through `payment_gateway.payouts`, and a pair lookup that never matches.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 157 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 157 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}

/**
 * Write `synced` onto every `payout` record that has no source yet, and answer
 * how many were written.
 *
 * **Archived instances are included.** A reversed or failed payout is still a
 * record the Stripe sync wrote, and its provenance is no less known for being
 * out of the way.
 *
 * One SELECT for the instances, one for the values already present, one INSERT
 * for the difference. Never a per-row loop.
 */
async function stampSynced(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  sourceFieldId: string
): Promise<number> {
  const instances = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
  if (instances.length === 0) return 0

  const already = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, sourceFieldId),
        inArray(
          schema.FieldValue.entityId,
          instances.map((row) => row.id)
        ),
        // A row whose `optionId` is null holds no answer, so it is not a value.
        isNotNull(schema.FieldValue.optionId)
      )
    )
  const held = new Set(already.map((row) => row.entityId))
  const missing = instances.filter((row) => !held.has(row.id))
  if (missing.length === 0) return 0

  const now = new Date()
  await db.insert(schema.FieldValue).values(
    missing.map((row) => ({
      organizationId,
      entityId: row.id,
      entityDefinitionId,
      fieldId: sourceFieldId,
      sortKey: generateKeyBetween(null, null),
      // `optionId` and NOTHING else - the single column the CRUD handler
      // writes for a select and the single column the payout read is fed from.
      optionId: SYNCED,
      updatedAt: now,
    }))
  )
  return missing.length
}
