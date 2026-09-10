// packages/lib/src/seed/entity-migrations/migrations/136-refunds-and-tax-lines.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { RelationDeleteBehavior } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import type { ResourceField } from '../../../resources/registry/field-types'
import { CONTACT_FIELDS } from '../../../resources/registry/resources/contact-fields'
import { CREDIT_MEMO_APPLICATION_FIELDS } from '../../../resources/registry/resources/credit-memo-application-fields'
import { CREDIT_MEMO_FIELDS } from '../../../resources/registry/resources/credit-memo-fields'
import { CREDIT_MEMO_LINE_FIELDS } from '../../../resources/registry/resources/credit-memo-line-fields'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { LINE_ITEM_FIELDS } from '../../../resources/registry/resources/line-item-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { TAX_LINE_FIELDS } from '../../../resources/registry/resources/tax-line-fields'
import { SystemUserService } from '../../../users/system-user-service'
import { DEFAULT_VIEW_CONFIGS } from '../../default-view-configs'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import { FIELD_REGISTRY } from '../../entity-seeder/create-fields'
import { buildFieldOptions } from '../../entity-seeder/utils'
import {
  ensureCustomFields,
  ensureDefaultTableViews,
  ensureEntityDefinitions,
  fieldKey,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:136')

/** What {@link ensureCustomFields} returns, keyed `<entityType>:<field id>`. */
type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/**
 * The four defs this migration creates. `credit_memo` is visible and has its
 * own records view; the other three are hidden and render inside their parent.
 */
const NEW_ENTITY_TYPES = [
  'credit_memo',
  'credit_memo_line',
  'credit_memo_application',
  'tax_line',
] as const

/**
 * Every relationship pair this migration must LINK, as
 * `<owning entityType>:<field id>` paired with the inverse it points at.
 *
 * Checked explicitly after {@link linkNewRelationships} rather than trusted,
 * because that helper only logs a debug line when it cannot resolve an inverse.
 * Entity migration 135 is why: an UNLINKED relationship is worse than a missing
 * one - the field exists so writes are accepted, but with no inverse the other
 * side reads empty and every consumer of it silently sees nothing.
 */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  { owning: `credit_memo:${CREDIT_MEMO_FIELDS.contact?.id}`, inverse: 'contact:creditMemos' },
  { owning: `credit_memo:${CREDIT_MEMO_FIELDS.invoice?.id}`, inverse: 'invoice:creditMemos' },
  { owning: `credit_memo:${CREDIT_MEMO_FIELDS.order?.id}`, inverse: 'order:creditMemos' },
  {
    owning: `credit_memo_line:${CREDIT_MEMO_LINE_FIELDS.creditMemo?.id}`,
    inverse: 'credit_memo:lines',
  },
  {
    owning: `credit_memo_line:${CREDIT_MEMO_LINE_FIELDS.lineItem?.id}`,
    inverse: 'line_item:creditMemoLines',
  },
  {
    owning: `credit_memo_application:${CREDIT_MEMO_APPLICATION_FIELDS.creditMemo?.id}`,
    inverse: 'credit_memo:applications',
  },
  {
    owning: `credit_memo_application:${CREDIT_MEMO_APPLICATION_FIELDS.invoice?.id}`,
    inverse: 'invoice:creditApplications',
  },
  { owning: `tax_line:${TAX_LINE_FIELDS.order?.id}`, inverse: 'order:taxLines' },
]

/** New fields added to defs that ALREADY exist, by entity type. */
const WIDENED: readonly {
  entityType: string
  source: Record<string, ResourceField>
  keys: string[]
}[] = [
  { entityType: 'order', source: ORDER_FIELDS, keys: ['creditMemos', 'taxLines'] },
  { entityType: 'line_item', source: LINE_ITEM_FIELDS, keys: ['taxTotal', 'creditMemoLines'] },
  { entityType: 'contact', source: CONTACT_FIELDS, keys: ['taxExempt', 'creditMemos'] },
  {
    entityType: 'invoice',
    source: INVOICE_FIELDS,
    keys: ['creditMemos', 'creditApplications', 'amountCredited'],
  },
]

/**
 * Migration 136: credit memos and channel-computed tax.
 *
 * Two plans land together because they share one connector field batch and one
 * per-org remap, and the remap cost is per batch: doing them separately pays it
 * twice (plans/money/tasks/48-shopify-tax-data.md §5).
 *
 * The first cut of this migration shipped `refund` and `refund_line` as an
 * ingest-only record of a Shopify refund. It ran on one machine and wrote zero
 * rows before plans/accounting/tasks/10-credit-memos.md folded that record and
 * the native "you owe us less" document into ONE entity, so the migration was
 * edited in place rather than followed by a 137 (10 §4.1). The local database
 * is repaired by `packages/lib/scripts/fix-local-136-rename.ts` (10 §4.2).
 *
 * ## What it adds
 *
 * - **`credit_memo` + `credit_memo_line`** (10 §2.1, §2.2) - the mirror of an
 *   invoice. Native: a person issues it from an invoice or from scratch, and it
 *   is settled later by applying, holding or refunding. Channel: the connector
 *   creates it from a refund that already happened at the sales channel, total
 *   equal to the amount refunded, so it lands settled the moment it is issued.
 *   `credit_memo_source` says which.
 * - **`credit_memo_application`** (10 §2.3) - one row per "this much of this
 *   memo went against this invoice". Not a `PaymentAllocation`, because an
 *   application is not money and must never post a payment entry.
 * - **`tax_line`** (48 §4.1) - one jurisdiction's share of one order's tax, as
 *   a ROW. Multi-jurisdiction is the norm, so a single rate on the order can
 *   never represent it, and the question being asked is tax by jurisdiction over
 *   a period, which is an aggregation and wants rows.
 * - **Eight relationship pairs**, plus `line_item_tax_total`,
 *   `contact_tax_exempt` and `invoice_amount_credited` on defs that already
 *   exist. `invoice_amount_credited` is what `syncInvoicePaymentState` subtracts
 *   so an applied credit reduces the balance without a ledger entry (10 §3.3).
 * - **`4090 Sales Returns and Allowances`** with its
 *   `revenue_returns_allowances` role (47 §6.1), which the credit memo issue
 *   entry debits (10 §3.1).
 * - **The delete-behavior stamp** (plans/relationships/01-delete-semantics.md).
 *   `options.relationship.onDelete` on every stored system relationship field
 *   of the org, copied from the registry, and the retired
 *   `constraints.onDeleteWithChildren` stripped wherever it is still stored.
 *   The seeder copies `onDelete` into stored options for a NEW org only; an
 *   existing org keeps whatever was copied the day it was seeded, which is
 *   nothing. It runs LAST so the eight owning fields this migration creates are
 *   covered whether this run created them or an earlier one did.
 * - **The three seed-only self-relation pairs, linked.** `build.reversalOf` /
 *   `reversedBy`, `stock_movement.parentMovement` / `childMovements` and
 *   `stock_movement.reversesMovement` / `reversedByMovements` carry
 *   `relationshipConfig` alone, and until this change the seeder ignored that
 *   block: every org seeded after migration 003 holds those six rows with
 *   `options = {"isCustom": false}`, no `relationship` block, no inverse. The
 *   delete engine cannot act on an edge it cannot see, so the pair is linked
 *   the way 003 step 2 linked it, right before the stamp gives it `onDelete`.
 *
 * ## What it deliberately does NOT do
 *
 * 🛑 **No backfill, and none is possible.** Nothing in auxx today holds a
 * credit memo to backfill FROM: the native document did not exist, and the
 * channel refund data is not carried by the connector yet - 47 §0.1: it carries
 * 25 `order_*` attributes and not one is a refund. Channel rows arrive on the
 * next sync after the connector bindings and the remap land, which is a
 * separate change in a separate repo. Native rows arrive when a person issues
 * one.
 *
 * ⚠️ **`4090` is emitted by `postings/build-credit-memo-entry.ts`** (10 §3.1),
 * which lands with this rename. The `ACCOUNT_ROLES` header names a role nothing
 * emits as a hazard - a mapping a bookkeeper can make wrongly with no way to
 * find out - so if that builder is ever removed, the account and role go with it.
 *
 * ## Ordering
 *
 * MUST sort after 107 (which creates `order` and `line_item`) and after 108
 * (which owns the chart). An org short of either is a skip, not a failure.
 *
 * Idempotent: `ensureCustomFields` is INSERT-only and skips a field that exists,
 * `linkNewRelationships` only writes an unset inverse, and the stamp writes a
 * row only when its stored options differ from what the registry says. The
 * chart addition this migration used to make is retired (17 §2) and is now a
 * literal no-op.
 */
export const migration136RefundsAndTaxLines: EntityMigration = {
  id: '136-refunds-and-tax-lines',
  description:
    'Adds the credit_memo, credit_memo_line, credit_memo_application and tax_line defs with ' +
    'their relationships to contact, invoice, order and line_item, line_item_tax_total, ' +
    'contact_tax_exempt and invoice_amount_credited, and 4090 Sales Returns and Allowances ' +
    '- the credit memo document (native or channel refund) and the tax rows the connector ' +
    'fills; stamps options.relationship.onDelete from the registry onto every stored system ' +
    'relationship field and strips the retired constraints.onDeleteWithChildren',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = {
      entityDefsCreated: 0,
      fieldsCreated: 0,
      relationshipsLinked: 0,
      deleteBehaviorsStamped: 0,
    }
    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of 107 has no order, line_item
    // or invoice, and the seeder creates all of this with the rest of the registry.
    const orderDef = existing.entityDefs.get('order')
    const lineItemDef = existing.entityDefs.get('line_item')
    const contactDef = existing.entityDefs.get('contact')
    const invoiceDef = existing.entityDefs.get('invoice')
    if (!orderDef || !lineItemDef || !contactDef || !invoiceDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    entityDefIds.set('order', orderDef.id)
    entityDefIds.set('line_item', lineItemDef.id)
    entityDefIds.set('contact', contactDef.id)
    entityDefIds.set('invoice', invoiceDef.id)

    // 🛑 ONE field map spanning EVERY def, new and widened alike.
    // `linkNewRelationships` resolves an inverse out of this map by
    // `<entityType>:<field id>`, so linking the halves of a pair in separate
    // calls would leave each unable to see the other and skip the pair with
    // nothing louder than a debug line (the 135 lesson).
    const fieldMap: EnsuredFieldMap = new Map()

    const newDefFields: Record<string, Record<string, ResourceField>> = {
      credit_memo: CREDIT_MEMO_FIELDS,
      credit_memo_line: CREDIT_MEMO_LINE_FIELDS,
      credit_memo_application: CREDIT_MEMO_APPLICATION_FIELDS,
      tax_line: TAX_LINE_FIELDS,
    }
    for (const entityType of NEW_ENTITY_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        newDefFields[entityType]!,
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    for (const { entityType, source, keys } of WIDENED) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        pick(source, keys, entityType),
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    // `credit_memo` is the one VISIBLE def here, so an existing org needs the
    // default table views a fresh org gets from `createDefaultViews` (All,
    // Needs review, Open credit). Idempotent: the helper returns once a view
    // exists for the table. `fieldMap` carries every credit_memo field whether
    // this run created it or an earlier one did, which is what the view config
    // resolves its column ids from.
    const creditMemoDefId = entityDefIds.get('credit_memo')
    if (creditMemoDefId) {
      const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
      await ensureDefaultTableViews(
        db,
        organizationId,
        systemUserId,
        'credit_memo',
        creditMemoDefId,
        DEFAULT_VIEW_CONFIGS.credit_memo,
        fieldMap
      )
    }

    // Read the org's fields FRESH rather than reusing `existing` from the top:
    // `linkNewRelationships` has written `inverseResourceFieldId` into stored
    // options since, and spreading the stale snapshot into an UPDATE would
    // erase that link on the very fields this migration just created. Both
    // steps below run after every insert and link, so the eight owning fields
    // this migration adds are stamped in the same run that created them.
    const current = await loadExistingState(db, organizationId)
    await linkSeedOnlyPairs(db, current, state)
    state.deleteBehaviorsStamped = await stampDeleteBehaviors(db, current)

    // NO-OP (plans/accounting/tasks/17-accounting-is-opt-in.md §2): this used
    // to call `seedDefaultChartOfAccounts` to add `4090 Sales Returns and
    // Allowances`. Accounting is opt-in now, so 136 no longer touches the
    // chart.
    const chart = { created: 0, rolesAssigned: 0 }

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      state.deleteBehaviorsStamped > 0 ||
      chart.created > 0 ||
      chart.rolesAssigned > 0

    if (changed) {
      // A new def and a new field are invisible to every read path that serves
      // them until the per-org caches are dropped. `runEntityMigrationsForOrg`
      // does this after the whole batch, but `up()` can also be called directly.
      await getOrgCache().invalidateAndRecompute(organizationId, [
        'entityDefs',
        'entityDefSlugs',
        'customFields',
        'resources',
      ])
      logger.info('Migration 136 applied', {
        organizationId,
        ...state,
        accountsCreated: chart.created,
        rolesAssigned: chart.rolesAssigned,
      })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/** The registry fields this migration adds to an existing def, loud if one was renamed. */
function pick(
  source: Record<string, ResourceField>,
  keys: readonly string[],
  entityType: string
): Record<string, ResourceField> {
  const picked: Record<string, ResourceField> = {}
  for (const key of keys) {
    const field = source[key]
    if (!field) {
      throw new Error(`${entityType} registry is missing the key "${key}" (migration 136)`)
    }
    picked[key] = field
  }
  return picked
}

/**
 * Verify every pair in {@link RELATIONSHIP_PAIRS} actually resolved its inverse.
 *
 * 🛑 Not a formality. `linkNewRelationships` skips an unresolvable pair with a
 * debug line, so without this the migration reports success having created eight
 * relationship fields that accept writes the other side cannot see. Entity
 * migration 135 added the same assertion for one pair after exactly that.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) {
      throw new Error(`migration 136 could not resolve the field ${owning}`)
    }
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 136 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}

// ─── The seed-only self-relation pairs ───────────────────────────────

/** What {@link loadExistingState} returns. */
type OrgState = Awaited<ReturnType<typeof loadExistingState>>

/**
 * Every registry field that describes its relationship through
 * `relationshipConfig` alone: the three self-relation pairs, six fields. A
 * field carrying both blocks is a normal pair and `linkNewRelationships` owns it.
 */
export function collectSeedOnlyRelationshipFields(): {
  entityType: string
  field: ResourceField
}[] {
  // The seeder's map, not RESOURCE_FIELD_REGISTRY: `tag` is seeded but absent from the latter.
  const registry = FIELD_REGISTRY
  const out: { entityType: string; field: ResourceField }[] = []
  for (const [entityType, fields] of Object.entries(registry)) {
    for (const field of Object.values(fields)) {
      if (field.relationshipConfig && !field.relationship && field.systemAttribute) {
        out.push({ entityType, field })
      }
    }
  }
  return out
}

/**
 * Give every seed-only pair whose stored row has no `relationship` block the
 * block the seeder now writes, with the inverse resolved by
 * `(relatedEntityType, inverseSystemAttribute)`. Modelled on migration 003
 * step 2, generic over the registry. A row that already carries a block is
 * never touched, whichever migration or seeder gave it one.
 *
 * The block itself comes from `buildFieldOptions`, so the shape is defined once
 * for the seeder and this migration alike; only the inverse id is filled in.
 * The in-memory row is updated too, so the stamp that follows sees the block.
 *
 * No FieldValue backfill: the delete engine reads the CHILD-side row
 * (`relatedEntityId IN parents AND fieldId = the belongs_to field`), and those
 * rows exist for every movement and build written so far.
 */
export async function linkSeedOnlyPairs(
  db: Database,
  current: OrgState,
  state: { relationshipsLinked: number }
): Promise<void> {
  const now = new Date()

  for (const { entityType, field } of collectSeedOnlyRelationshipFields()) {
    const config = field.relationshipConfig!
    const def = current.entityDefs.get(entityType)
    if (!def) continue
    const row = current.fields.get(fieldKey(def.id, field.systemAttribute!))
    if (!row || row.options?.relationship) continue

    const relatedDef = current.entityDefs.get(config.relatedEntityType)
    const inverse = relatedDef
      ? current.fields.get(fieldKey(relatedDef.id, config.inverseSystemAttribute))
      : undefined
    if (!relatedDef || !inverse) {
      logger.warn('Seed-only pair has no inverse row to link to; skipping', {
        field: `${entityType}:${field.systemAttribute}`,
        inverse: `${config.relatedEntityType}:${config.inverseSystemAttribute}`,
      })
      continue
    }

    const block = buildFieldOptions(field).relationship!
    const options: FieldOptions = {
      ...row.options,
      relationship: {
        ...block,
        inverseResourceFieldId: toResourceFieldId(relatedDef.id, inverse.id),
      },
    }

    await db
      .update(schema.CustomField)
      .set({ options, updatedAt: now })
      .where(eq(schema.CustomField.id, row.id))

    row.options = options
    state.relationshipsLinked++
    logger.debug(`Linked seed-only pair: ${entityType}:${field.systemAttribute}`)
  }
}

// ─── The delete-behavior stamp ───────────────────────────────────────

/**
 * Every registry-declared delete behavior, keyed `<entityType>:<systemAttribute>`,
 * which is how a stored `CustomField` row is addressed within one org.
 *
 * Both declaration sites count: `relationship.onDelete` on a linked pair, and
 * `relationshipConfig.onDelete` on the three seed-only self-relations that
 * {@link linkSeedOnlyPairs} has just given a block. The registry never declares
 * it on a belongs_to side, so a stored belongs_to row is only ever stripped,
 * never stamped.
 */
export function collectDeleteBehaviorStamps(): Map<string, RelationDeleteBehavior> {
  const stamps = new Map<string, RelationDeleteBehavior>()
  // The seeder's map, not RESOURCE_FIELD_REGISTRY: `tag` is seeded but absent from the latter.
  const registry = FIELD_REGISTRY
  for (const [entityType, fields] of Object.entries(registry)) {
    for (const field of Object.values(fields)) {
      if (!field.systemAttribute) continue
      const onDelete = field.relationship?.onDelete ?? field.relationshipConfig?.onDelete
      if (onDelete === undefined) continue
      stamps.set(`${entityType}:${field.systemAttribute}`, onDelete)
    }
  }
  return stamps
}

/**
 * The stored options after the stamp, or `null` when nothing would change.
 *
 * Two edits, both inside `options.relationship`: set `onDelete` to the registry
 * value when one is given and the stored value differs, and drop the retired
 * `constraints.onDeleteWithChildren` (removing `constraints` outright once it is
 * empty, keeping `preventCircular` / `maxDepth` when they are there). Every
 * other key, `inverseResourceFieldId` above all, passes through untouched.
 *
 * A row with no `relationship` block is returned as unchanged on purpose: a
 * block holding only `onDelete` has no `relationshipType` and no inverse, and
 * the delete engine would read it as an owning edge it cannot follow. After
 * {@link linkSeedOnlyPairs} no system relationship row should be in that state.
 */
export function withDeleteBehavior(
  options: FieldOptions | null | undefined,
  onDelete: RelationDeleteBehavior | undefined
): FieldOptions | null {
  const relationship = options?.relationship
  if (!relationship) return null

  let changed = false
  const next = { ...relationship }

  const constraints = relationship.constraints as Record<string, unknown> | undefined
  if (constraints && 'onDeleteWithChildren' in constraints) {
    const { onDeleteWithChildren: _retired, ...kept } = constraints
    if (Object.keys(kept).length > 0) next.constraints = kept
    else delete next.constraints
    changed = true
  }

  if (onDelete !== undefined && relationship.onDelete !== onDelete) {
    next.onDelete = onDelete
    changed = true
  }

  return changed ? { ...options, relationship: next } : null
}

/**
 * Stamp the registry's `onDelete` onto the org's stored system relationship
 * fields and strip `onDeleteWithChildren`. Returns the number of rows written.
 *
 * `current` must be loaded after every other write in `up()` (see the call
 * site): a stale options snapshot spread into an UPDATE erases whatever was
 * written since, the inverse links above all.
 *
 * One UPDATE per changed row. Roughly 70 rows per org on the first run (the
 * registry declares about that many owning edges, plus the two `*_parent`
 * rows still carrying `onDeleteWithChildren`) and zero on every run after,
 * because a stored row that already matches the registry is never written.
 */
async function stampDeleteBehaviors(db: Database, current: OrgState): Promise<number> {
  const stamps = collectDeleteBehaviorStamps()

  const entityTypeByDefId = new Map<string, string>()
  for (const def of current.entityDefs.values()) entityTypeByDefId.set(def.id, def.entityType)

  const now = new Date()
  let written = 0

  for (const field of current.fields.values()) {
    const entityType = entityTypeByDefId.get(field.entityDefinitionId)
    if (!entityType) continue

    const next = withDeleteBehavior(
      field.options,
      stamps.get(`${entityType}:${field.systemAttribute}`)
    )
    if (!next) continue

    await db
      .update(schema.CustomField)
      .set({ options: next, updatedAt: now })
      .where(eq(schema.CustomField.id, field.id))
    written++
  }

  return written
}
