// packages/lib/src/data-migrations/migrations/172-vendor-bill-match-status.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { VendorBillStatus } from '../../resources/registry/enum-values'
import type { ResourceField } from '../../resources/registry/field-types'
import { VENDOR_BILL_FIELDS } from '../../resources/registry/resources/vendor-bill-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:172')

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/** One stored option, as `CustomField.options.options[]` holds it. */
interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/** The three verdict values 73 D1 moves off `vendor_bill_status`. */
const RETIRED_STATUS_VALUES = new Set(['awaiting_receipt', 'matched', 'exception'])

/**
 * The lifecycle option set an org should be carrying after 73 D1's second half,
 * or `null` when it already is.
 *
 * 🛑 **Re-materialised, not appended**, for the reason 171 gives: `ensureCustomFields`
 * never updates an existing field's options, so leaving `matched` in the list means a
 * person can type the verdict the split exists to compute. An option an org added
 * itself is kept, at the end.
 *
 * Pure, so the rule is testable without a database.
 */
export function rematerialiseLifecycleOptions(
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

export interface Migration172Result extends PerOrgMigrationResult {
  /** Bills whose stored verdict was moved onto the new match field. */
  billsRemapped: number
  /** Whether the lifecycle option set was re-materialised on this org. */
  statusOptionsRewritten: boolean
}

/**
 * Migration 172: the match verdict becomes its own field (73 D1, U1).
 *
 *  1. Add `vendor_bill_match_status` to the `vendor_bill` def, with its options.
 *  2. Move every bill stored at `awaiting_receipt` / `matched` / `exception` onto
 *     `draft` plus that verdict on the new field.
 *  3. Re-materialise `vendor_bill_status`'s options down to the three lifecycle
 *     values.
 *
 * Idempotent: the ensure is INSERT-only, the remap selects only rows still
 * carrying a retired value, and the option rewrite is a no-op once the list matches.
 */
export const migration172VendorBillMatchStatus: PerOrgMigration = {
  id: '172-vendor-bill-match-status',
  description:
    'Splits the three-way match verdict off vendor_bill_status onto the new ' +
    'vendor_bill_match_status field, and shrinks the lifecycle to draft/posted/void (73 D1).',

  async up(db: Database, organizationId: string): Promise<Migration172Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    // Absent rather than failed: an org with no bill def has not been seeded from
    // the current registry at all.
    const billDef = existing.entityDefs.get('vendor_bill')
    if (!billDef) {
      return { ...state, alreadyUpToDate: true, billsRemapped: 0, statusOptionsRewritten: false }
    }

    const matchStatusField = VENDOR_BILL_FIELDS.matchStatus
    if (!matchStatusField) throw new Error('registry is missing vendor_bill.matchStatus')
    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      'vendor_bill',
      billDef.id,
      { matchStatus: matchStatusField as ResourceField },
      existing,
      state
    )
    const matchStatusFieldId = fieldMap.get(`vendor_bill:${matchStatusField.id}`)?.id
    if (!matchStatusFieldId) {
      throw new Error('migration 172 could not resolve vendor_bill_match_status')
    }

    const statusField = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, billDef.id),
        eq(schema.CustomField.systemAttribute, 'vendor_bill_status')
      ),
      columns: { id: true, options: true },
    })

    let billsRemapped = 0
    let statusOptionsRewritten = false
    if (statusField) {
      // The remap runs BEFORE the option rewrite, so a stored value still has its
      // option row to be read off while it is being moved.
      billsRemapped = await remapVerdictBills(
        db,
        organizationId,
        statusField.id,
        matchStatusFieldId
      )

      const stored = (statusField.options as { options?: StoredOption[] } | null)?.options
      if (Array.isArray(stored)) {
        const next = rematerialiseLifecycleOptions(
          stored,
          VendorBillStatus.values as StoredOption[]
        )
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

    const changed = state.fieldsCreated > 0 || statusOptionsRewritten || billsRemapped > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 172 applied', {
        organizationId,
        ...state,
        billsRemapped,
        statusOptionsRewritten,
      })
    }

    return { ...state, alreadyUpToDate: !changed, billsRemapped, statusOptionsRewritten }
  },
}

/**
 * Move every bill stored at a verdict value onto `draft` plus the new match field.
 *
 * One `UPDATE` per axis, no record layer: the match field is `updatable: false` by
 * design, and a FieldValue rewrite is the only door that does not have to be argued
 * past its own guard. This is 171's `remapPaidBills`, one axis over.
 */
async function remapVerdictBills(
  db: Database,
  organizationId: string,
  statusFieldId: string,
  matchStatusFieldId: string
): Promise<number> {
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
    const verdict = row.optionId
    await db
      .update(schema.FieldValue)
      .set({ optionId: VendorBillStatus.DRAFT, updatedAt: new Date() })
      .where(eq(schema.FieldValue.id, row.id))
    await db
      .insert(schema.FieldValue)
      .values({
        organizationId,
        entityId: row.entityId,
        entityDefinitionId: row.entityDefinitionId,
        fieldId: matchStatusFieldId,
        optionId: verdict,
      })
      .onConflictDoNothing()
    remapped += 1
  }
  return remapped
}
