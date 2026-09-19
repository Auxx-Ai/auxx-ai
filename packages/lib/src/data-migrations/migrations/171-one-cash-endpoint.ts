// packages/lib/src/data-migrations/migrations/171-one-cash-endpoint.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { VendorBillStatus } from '../../resources/registry/enum-values'
import type { ResourceField } from '../../resources/registry/field-types'
import { COMPANY_FIELDS } from '../../resources/registry/resources/company-fields'
import { PURCHASE_ORDER_FIELDS } from '../../resources/registry/resources/purchase-order-fields'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { VENDOR_CREDIT_APPLICATION_FIELDS } from '../../resources/registry/resources/vendor-credit-application-fields'
import { VENDOR_CREDIT_FIELDS } from '../../resources/registry/resources/vendor-credit-fields'
import { VENDOR_CREDIT_LINE_FIELDS } from '../../resources/registry/resources/vendor-credit-line-fields'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:171')

type EnsuredFieldMap = Awaited<ReturnType<typeof ensureCustomFields>>

/** A removed field or def is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['entityDefs', 'entityDefSlugs', 'customFields', 'resources'] as const

/** The three defs this migration creates (71 §5 U7). */
const NEW_ENTITY_TYPES = [
  'vendor_credit',
  'vendor_credit_line',
  'vendor_credit_application',
] as const

const NEW_DEF_FIELDS: Record<string, Record<string, ResourceField>> = {
  vendor_credit: VENDOR_CREDIT_FIELDS,
  vendor_credit_line: VENDOR_CREDIT_LINE_FIELDS,
  vendor_credit_application: VENDOR_CREDIT_APPLICATION_FIELDS,
}

/** Existing defs the new graph hangs off. An org short of any is a SKIP. */
const REQUIRED_ENTITY_TYPES = ['company', 'vendor_bill', 'purchase_order', 'part'] as const

/** The halves this migration adds to defs that already exist. */
const WIDENED_DEF_FIELDS: Record<string, Record<string, ResourceField | undefined>> = {
  company: { vendorCredits: COMPANY_FIELDS.vendorCredits },
  purchase_order: { vendorCredits: PURCHASE_ORDER_FIELDS.vendorCredits },
  vendor_bill: {
    // 73 D1's money axis, and 71 U7's two halves plus the credited mirror.
    paymentStatus: VENDOR_BILL_FIELDS.paymentStatus,
    amountCredited: VENDOR_BILL_FIELDS.amountCredited,
    vendorCredits: VENDOR_BILL_FIELDS.vendorCredits,
    creditApplications: VENDOR_BILL_FIELDS.creditApplications,
  },
}

/** Every relationship pair this migration must LINK, checked rather than trusted. */
const RELATIONSHIP_PAIRS: readonly { owning: string; inverse: string }[] = [
  { owning: `vendor_credit:${VENDOR_CREDIT_FIELDS.vendor?.id}`, inverse: 'company:vendorCredits' },
  { owning: `company:${COMPANY_FIELDS.vendorCredits?.id}`, inverse: 'vendor_credit:vendor' },
  {
    owning: `vendor_credit:${VENDOR_CREDIT_FIELDS.bill?.id}`,
    inverse: 'vendor_bill:vendorCredits',
  },
  { owning: `vendor_bill:${VENDOR_BILL_FIELDS.vendorCredits?.id}`, inverse: 'vendor_credit:bill' },
  {
    owning: `vendor_credit:${VENDOR_CREDIT_FIELDS.purchaseOrder?.id}`,
    inverse: 'purchase_order:vendorCredits',
  },
  {
    owning: `purchase_order:${PURCHASE_ORDER_FIELDS.vendorCredits?.id}`,
    inverse: 'vendor_credit:purchaseOrder',
  },
  {
    owning: `vendor_credit:${VENDOR_CREDIT_FIELDS.lines?.id}`,
    inverse: 'vendor_credit_line:vendorCredit',
  },
  {
    owning: `vendor_credit_line:${VENDOR_CREDIT_LINE_FIELDS.vendorCredit?.id}`,
    inverse: 'vendor_credit:lines',
  },
  {
    owning: `vendor_credit:${VENDOR_CREDIT_FIELDS.applications?.id}`,
    inverse: 'vendor_credit_application:vendorCredit',
  },
  {
    owning: `vendor_credit_application:${VENDOR_CREDIT_APPLICATION_FIELDS.vendorCredit?.id}`,
    inverse: 'vendor_credit:applications',
  },
  {
    owning: `vendor_credit_application:${VENDOR_CREDIT_APPLICATION_FIELDS.vendorBill?.id}`,
    inverse: 'vendor_bill:creditApplications',
  },
  {
    owning: `vendor_bill:${VENDOR_BILL_FIELDS.creditApplications?.id}`,
    inverse: 'vendor_credit_application:vendorBill',
  },
]

/** The two inert defs 71 U5 removed from the registry. Existing orgs still carry them. */
const REMOVED_ENTITY_TYPES = ['vendor_payment', 'vendor_payment_allocation'] as const

/** The one forward half into the removed defs. */
const REMOVED_RELATIONSHIPS: readonly { entityType: string; systemAttribute: string }[] = [
  { entityType: 'vendor_bill', systemAttribute: 'vendor_bill_payment_allocations' },
  { entityType: 'vendor_bill', systemAttribute: 'vendor_bill_paid_source' },
  { entityType: 'vendor_bill', systemAttribute: 'vendor_bill_payment_method' },
  { entityType: 'vendor_bill', systemAttribute: 'vendor_bill_payment_reference' },
]

/** One stored option, as `CustomField.options.options[]` holds it. */
interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** The two money values 73 D1 removes from `vendor_bill_status`. */
const RETIRED_STATUS_VALUES = new Set(['partially_paid', 'paid'])

/**
 * The lifecycle option set an org should be carrying after 73 D1, or `null`
 * when it already is.
 *
 * 🛑 **Re-materialised, not appended.** `ensureCustomFields` never updates an
 * existing field's options, so the eight-value list seeded before this is what
 * every dropdown still builds itself from; leaving `paid` in it means a person
 * can re-type the value the split exists to remove. An option an org added
 * itself is kept, at the end.
 *
 * Pure, so the rule is testable without a database.
 */
export function rematerialiseStatusOptions(
  stored: readonly StoredOption[],
  registry: readonly StoredOption[]
): StoredOption[] | null {
  const byValue = new Map(stored.map((option) => [option.value, option]))
  const known = new Set(registry.map((option) => option.value))
  const next: StoredOption[] = [
    ...registry.map((option) => byValue.get(option.value) ?? option),
    ...stored.filter(
      (option) => !known.has(option.value) && !RETIRED_STATUS_VALUES.has(option.value)
    ),
  ]
  const changed =
    next.length !== stored.length || next.some((option, i) => stored[i]?.value !== option.value)
  return changed ? next : null
}

export interface Migration171Result extends PerOrgMigrationResult {
  /** Bills whose stored `paid`/`partially_paid` was mapped onto the two axes. */
  billsRemapped: number
  /** Whether the status option set was re-materialised on this org. */
  statusOptionsRewritten: boolean
  /** Of the removed fields, how many existed and were deleted. */
  fieldsRemoved: number
  /** How many of the two inert defs were archived. */
  defsArchived: number
}

/**
 * Migration 171: the whole of the one-cash-endpoint branch, per org, in order.
 *
 *  1. **73 D1** — re-materialise `vendor_bill_status`'s options down to the six
 *     lifecycle values, and map every bill stored at `paid` / `partially_paid`
 *     onto `posted` plus the new `vendor_bill_payment_status`.
 *  2. **71 U5** — remove the `vendor_payment` / `vendor_payment_allocation`
 *     defs and the four bill fields that went with them.
 *  3. **71 U7** — add the `vendor_credit` def and its two owned children, plus
 *     the halves they need on `company`, `vendor_bill` and `purchase_order`.
 *
 * Step 3's fields land BEFORE step 1's remap needs them, so the two are
 * deliberately interleaved: the defs and fields are ensured first, then the
 * option rewrite and the value remap run against a provisioned org.
 *
 * Idempotent throughout: the ensures are INSERT-only, the option rewrite is a
 * no-op once the list matches, the remap selects only rows still carrying a
 * retired value, and each removal is gated on the row still being there.
 */
export const migration171OneCashEndpoint: PerOrgMigration = {
  id: '171-one-cash-endpoint',
  description:
    'Splits the vendor bill status axes (73 D1), removes the inert vendor_payment entity pair ' +
    '(71 U5), and adds the vendor_credit def with its lines and applications plus the halves ' +
    'they need on company, vendor_bill and purchase_order (71 U7).',

  async up(db: Database, organizationId: string): Promise<Migration171Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org short of any of these has not been
    // seeded from the current registry at all.
    const requiredDefIds = new Map<string, string>()
    for (const entityType of REQUIRED_ENTITY_TYPES) {
      const def = existing.entityDefs.get(entityType)
      if (!def)
        return {
          ...state,
          alreadyUpToDate: true,
          billsRemapped: 0,
          statusOptionsRewritten: false,
          fieldsRemoved: 0,
          defsArchived: 0,
        }
      requiredDefIds.set(entityType, def.id)
    }

    // ── 71 U7: the three new defs and the widened existing ones ──────────────
    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => (NEW_ENTITY_TYPES as readonly string[]).includes(e.entityType)),
      existing,
      state
    )
    for (const [entityType, defId] of requiredDefIds) entityDefIds.set(entityType, defId)

    // 🛑 ONE field map spanning the new defs AND the widened existing ones:
    // `linkNewRelationships` resolves an inverse out of this map, so linking a
    // pair's halves in separate calls would skip the pair with nothing louder
    // than a debug line (the 135 lesson, restated by 154).
    const fieldMap: EnsuredFieldMap = new Map()

    for (const entityType of NEW_ENTITY_TYPES) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const created = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        NEW_DEF_FIELDS[entityType]!,
        existing,
        state
      )
      for (const [key, value] of created) fieldMap.set(key, value)
    }

    for (const [entityType, fields] of Object.entries(WIDENED_DEF_FIELDS)) {
      const defId = entityDefIds.get(entityType)
      if (!defId) continue
      const resolved: Record<string, ResourceField> = {}
      for (const [key, field] of Object.entries(fields)) {
        if (!field) throw new Error(`registry is missing ${entityType}.${key} (migration 171)`)
        resolved[key] = field
      }
      const widened = await ensureCustomFields(
        db,
        organizationId,
        entityType,
        defId,
        resolved,
        existing,
        state
      )
      for (const [key, value] of widened) fieldMap.set(key, value)
    }

    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)
    await linkDisplayFields(db, [...NEW_ENTITY_TYPES], entityDefIds, fieldMap)

    // ── 73 D1: the option rewrite and the value remap ────────────────────────
    const billDefId = requiredDefIds.get('vendor_bill')!
    const statusField = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, billDefId),
        eq(schema.CustomField.systemAttribute, 'vendor_bill_status')
      ),
      columns: { id: true, options: true },
    })

    let statusOptionsRewritten = false
    let billsRemapped = 0
    if (statusField) {
      // The remap runs BEFORE the option rewrite, so a stored value still has
      // its option row to be read off while it is being moved.
      billsRemapped = await remapPaidBills(db, organizationId, statusField.id, fieldMap, billDefId)

      const stored = (statusField.options as { options?: StoredOption[] } | null)?.options
      if (Array.isArray(stored)) {
        const next = rematerialiseStatusOptions(stored, VendorBillStatus.values as StoredOption[])
        if (next) {
          await db
            .update(schema.CustomField)
            .set({
              options: { ...(statusField.options as Record<string, unknown>), options: next },
              updatedAt: new Date(),
            })
            .where(eq(schema.CustomField.id, statusField.id))
          statusOptionsRewritten = true
        }
      }
    }

    // ── 71 U5: the removals ──────────────────────────────────────────────────
    let fieldsRemoved = 0
    for (const { entityType, systemAttribute } of REMOVED_RELATIONSHIPS) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue // Absent rather than failed: a fresh install never seeds this.
      const removed = await db
        .delete(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, def.id),
            eq(schema.CustomField.systemAttribute, systemAttribute)
          )
        )
        .returning({ id: schema.CustomField.id })
      fieldsRemoved += removed.length
    }

    let defsArchived = 0
    for (const entityType of REMOVED_ENTITY_TYPES) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue
      const archivedDefs = await db
        .update(schema.EntityDefinition)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.EntityDefinition.organizationId, organizationId),
            eq(schema.EntityDefinition.id, def.id),
            isNull(schema.EntityDefinition.archivedAt)
          )
        )
        .returning({ id: schema.EntityDefinition.id })
      defsArchived += archivedDefs.length

      await db
        .update(schema.EntityInstance)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, def.id),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
    }

    const changed =
      state.entityDefsCreated > 0 ||
      state.fieldsCreated > 0 ||
      state.relationshipsLinked > 0 ||
      statusOptionsRewritten ||
      billsRemapped > 0 ||
      fieldsRemoved > 0 ||
      defsArchived > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 171 applied', {
        organizationId,
        ...state,
        billsRemapped,
        statusOptionsRewritten,
        fieldsRemoved,
        defsArchived,
      })
    }

    return {
      ...state,
      alreadyUpToDate: !changed,
      billsRemapped,
      statusOptionsRewritten,
      fieldsRemoved,
      defsArchived,
    }
  },
}

/**
 * Move every bill stored at `paid` / `partially_paid` onto `posted` plus the
 * new money axis. One `UPDATE` per axis, no record layer: the payment status
 * field is `updatable: false` by design, and a FieldValue rewrite is the only
 * door that does not have to be argued past its own guard.
 */
async function remapPaidBills(
  db: Database,
  organizationId: string,
  statusFieldId: string,
  fieldMap: EnsuredFieldMap,
  billDefId: string
): Promise<number> {
  const paymentStatusFieldId =
    fieldMap.get(`vendor_bill:${VENDOR_BILL_FIELDS.paymentStatus?.id}`)?.id ??
    (
      await db.query.CustomField.findFirst({
        where: and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, billDefId),
          eq(schema.CustomField.systemAttribute, 'vendor_bill_payment_status')
        ),
        columns: { id: true },
      })
    )?.id
  if (!paymentStatusFieldId) return 0

  const rows = await db
    .select({
      id: schema.FieldValue.id,
      entityId: schema.FieldValue.entityId,
      entityDefinitionId: schema.FieldValue.entityDefinitionId,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, statusFieldId)
      )
    )

  let remapped = 0
  for (const row of rows) {
    if (!row.optionId || !RETIRED_STATUS_VALUES.has(row.optionId)) continue
    const money = row.optionId
    await db
      .update(schema.FieldValue)
      .set({ optionId: VendorBillStatus.POSTED, updatedAt: new Date() })
      .where(eq(schema.FieldValue.id, row.id))
    await db
      .insert(schema.FieldValue)
      .values({
        organizationId,
        entityId: row.entityId,
        entityDefinitionId: row.entityDefinitionId,
        fieldId: paymentStatusFieldId,
        optionId: money,
      })
      .onConflictDoNothing()
    remapped += 1
  }
  return remapped
}

/** Fail loudly when a relationship half was created but never linked. */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  for (const { owning, inverse } of RELATIONSHIP_PAIRS) {
    const field = fieldMap.get(owning)
    if (!field) throw new Error(`migration 171 could not resolve the field ${owning}`)
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId)
      throw new Error(
        `migration 171 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
  }
}
