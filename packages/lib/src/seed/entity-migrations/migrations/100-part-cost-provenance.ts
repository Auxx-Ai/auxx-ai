// packages/lib/src/seed/entity-migrations/migrations/100-part-cost-provenance.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { recalculateAllPartCosts } from '../../../bom'
import { getOrgCache } from '../../../cache'
import { PART_FIELDS } from '../../../resources/registry/resources/part-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:100')

/**
 * The retired field. `part_unit_price` exposed exactly one of the four
 * components of a landed cost (raw supplier price, no shipping, tariff or other
 * cost), had no reader anywhere in the product, and collided head-on with the
 * Shopify variant price that wants the same slug for the opposite meaning —
 * a SELL price written by a connector, not a COST written by the recalculator.
 * Two writers on one column; the connector's price goes to an app field instead.
 *
 * `part_purchase_cost` replaces it with the better number: the winning vendor
 * part's full landed cost.
 */
const REMOVED_ATTR = 'part_unit_price'

/** The four fields this migration materializes, for the log line. */
const ADDED_ATTRS = [
  'part_purchase_cost',
  'part_rollup_cost',
  'part_cost_source',
  'part_kind',
] as const

// ─── TableView pruning ───────────────────────────────────────────────

/**
 * A `TableView.config` blob. Deliberately loose: the column is `jsonb` with no
 * DB-level shape, two different context families store two different key sets
 * into it, and zod strips unknown keys on read — so a pruner that insisted on a
 * parsed shape would drop whatever it did not model.
 */
type ViewConfigBlob = Record<string, unknown>

/** Remove `id` from a `{ [resourceFieldId]: … }` map, in place-ish. */
function pruneRecordKey(config: ViewConfigBlob, key: string, ids: Set<string>): boolean {
  const value = config[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const record = value as Record<string, unknown>
  const survivors = Object.entries(record).filter(([k]) => !ids.has(k))
  if (survivors.length === Object.keys(record).length) return false

  config[key] = Object.fromEntries(survivors)
  return true
}

/** Remove `id` from a `string[]` of resourceFieldIds. */
function pruneStringArray(config: ViewConfigBlob, key: string, ids: Set<string>): boolean {
  const value = config[key]
  if (!Array.isArray(value)) return false

  const survivors = value.filter((entry) => typeof entry !== 'string' || !ids.has(entry))
  if (survivors.length === value.length) return false

  config[key] = survivors
  return true
}

/**
 * Strip every reference to a deleted field from one `TableView.config`.
 *
 * **Why this is required and has no precedent to copy.** There is no foreign key
 * from `TableView` to `CustomField`, so deleting the field leaves its
 * `resourceFieldId` sitting in user-editable jsonb. `getOrgFieldView` returns
 * the raw config and filters nothing — the tolerance lives downstream, where
 * `mergeFieldOrder` drops ids with no matching registry field on read. But that
 * merge result is what gets PERSISTED on the next view edit, so the ghost
 * survives in the stored row until something rewrites it, and anyone reading the
 * config directly still sees an id pointing at nothing. Clean the row.
 *
 * **Two key families, because there are two.** Panel and dialog views store
 * `fieldVisibility` / `fieldOrder` / `fieldLabels` / `fieldGroups`; table and
 * kanban views store `columnVisibility` / `columnOrder` / `columnLabels` /
 * `columnSizing` / `columnFormatting` / `columnPinning`. Only the first pair was
 * named in the plan; pruning one family would have left the "All Parts" table
 * view dangling.
 *
 * **Filters and sorting are pruned too, and that is not cosmetic.** A condition
 * on a field that no longer exists cannot compile, and the condition builder
 * fails OPEN — it drops what it cannot compile, so the filter is already
 * silently ineffective at query time. Removing it from the config makes the
 * stored view agree with what the query already does, rather than showing the
 * user a filter chip that does nothing. A filter GROUP left with no conditions
 * is dropped as well: an empty group is the bare org scope, which matches
 * everything.
 *
 * @param config - The stored `TableView.config` blob
 * @param fieldIds - Every id spelling the deleted field can appear under
 * @returns The pruned config and whether anything was actually removed
 */
export function pruneViewConfigFields(
  config: unknown,
  fieldIds: readonly string[]
): { config: unknown; changed: boolean } {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { config, changed: false }
  }

  const ids = new Set(fieldIds)
  const next = { ...(config as ViewConfigBlob) }
  let changed = false

  const recordKeys = [
    'fieldVisibility',
    'fieldLabels',
    'columnVisibility',
    'columnLabels',
    'columnSizing',
    'columnFormatting',
  ]
  for (const key of recordKeys) {
    if (pruneRecordKey(next, key, ids)) changed = true
  }

  for (const key of ['fieldOrder', 'columnOrder']) {
    if (pruneStringArray(next, key, ids)) changed = true
  }

  // columnPinning: { left?: string[], right?: string[] }
  const pinning = next.columnPinning
  if (pinning && typeof pinning === 'object' && !Array.isArray(pinning)) {
    const pinned = { ...(pinning as ViewConfigBlob) }
    let pinnedChanged = false
    for (const side of ['left', 'right']) {
      if (pruneStringArray(pinned, side, ids)) pinnedChanged = true
    }
    if (pinnedChanged) {
      next.columnPinning = pinned
      changed = true
    }
  }

  // fieldGroups: [{ fieldIds: string[], anchorFieldId?: string }]
  if (Array.isArray(next.fieldGroups)) {
    let groupsChanged = false
    const groups = next.fieldGroups.map((group) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return group
      const copy = { ...(group as ViewConfigBlob) }
      if (pruneStringArray(copy, 'fieldIds', ids)) groupsChanged = true
      if (typeof copy.anchorFieldId === 'string' && ids.has(copy.anchorFieldId)) {
        // Unset means "render at the end" — the schema's own fallback.
        copy.anchorFieldId = undefined
        groupsChanged = true
      }
      return copy
    })
    if (groupsChanged) {
      next.fieldGroups = groups
      changed = true
    }
  }

  // sorting: [{ id, desc }] — a sort on a field that no longer exists is inert.
  if (Array.isArray(next.sorting)) {
    const survivors = next.sorting.filter((entry) => {
      if (!entry || typeof entry !== 'object') return true
      const id = (entry as ViewConfigBlob).id
      return typeof id !== 'string' || !ids.has(id)
    })
    if (survivors.length !== next.sorting.length) {
      next.sorting = survivors
      changed = true
    }
  }

  // filters: [{ conditions: [{ fieldId }] }] — see the JSDoc note above.
  if (Array.isArray(next.filters)) {
    let filtersChanged = false
    const groups: unknown[] = []
    for (const group of next.filters) {
      if (!group || typeof group !== 'object' || Array.isArray(group)) {
        groups.push(group)
        continue
      }
      const copy = { ...(group as ViewConfigBlob) }
      if (Array.isArray(copy.conditions)) {
        const survivors = copy.conditions.filter((condition) => {
          if (!condition || typeof condition !== 'object') return true
          const fieldId = (condition as ViewConfigBlob).fieldId
          return typeof fieldId !== 'string' || !ids.has(fieldId)
        })
        if (survivors.length !== copy.conditions.length) {
          filtersChanged = true
          // A group with every condition dropped reduces to the bare org scope,
          // which matches every row. Drop the group instead of widening the view.
          if (survivors.length === 0) continue
          copy.conditions = survivors
        }
      }
      groups.push(copy)
    }
    if (filtersChanged) {
      next.filters = groups
      changed = true
    }
  }

  return { config: next, changed }
}

// ─── Migration ───────────────────────────────────────────────────────

/**
 * Migration 100: give `part_cost` provenance, and retire `part_unit_price`.
 *
 * `part_cost` is one stored output with two silent meanings — the landed vendor
 * cost of a purchased part, and the sum of its children for an assembly — with
 * nothing on the record saying which. That is why a `NULL` there carried no
 * information, and why a part that lost its last supplier could keep a frozen
 * number indistinguishable from a fresh one. This migration materializes the
 * fields that make the distinction expressible:
 *
 *  - `part_purchase_cost` — the winning vendor part's landed cost
 *  - `part_rollup_cost`   — the bill-of-materials sum, recorded even when a
 *                           vendor price wins, so buy-vs-build is comparable
 *  - `part_cost_source`   — `vendor` / `bom` / `none`; `none` is the point,
 *                           because "not costed" was previously unrepresentable
 *  - `part_kind`          — human classification (`component` / `subassembly` /
 *                           `finished_good`). The FIELD only: its consumers land
 *                           with the build-event work. No backfill — an absent
 *                           value reads NULL and every reader treats NULL as
 *                           `component`, preserving today's behaviour.
 *
 * `part_cost` itself keeps its slug, its consumers and its position; the new
 * fields sit underneath it.
 *
 * **No DDL.** Pure `CustomField` + `FieldValue` + registry, like every entity
 * migration here.
 *
 * **No view rebuild, and none needed.** `ensureFieldViews` deliberately skips
 * any entity/context that already has a view — those rows are user-editable and
 * a migration must not reorder them. The new fields still surface everywhere,
 * because both read paths merge against the LIVE registry rather than trusting
 * the stored config: `mergeFieldOrder` (web) walks the baseline id list and
 * splices any id missing from the stored `fieldOrder` in at its `sortOrder`
 * anchor, so `a5b`/`a5c`/`a5d` land directly above `part_cost` (`a6`) instead of
 * dead last; and `resolveFieldVisible` falls back to the registry default when a
 * field has no explicit `fieldVisibility` entry. The three computed fields carry
 * `showInTable: false`, so they join the panel but not the parts list — that is
 * the registry's call, not this migration's.
 *
 * Idempotent — `ensureCustomFields` is insert-only, the delete finds no row on a
 * re-run, and the view pruning is a no-op once nothing references the field.
 */
export const migration100PartCostProvenance: EntityMigration = {
  id: '100-part-cost-provenance',
  description:
    'Add part cost provenance fields (purchase cost, roll-up cost, cost source) plus part kind, and remove the retired part_unit_price field',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const partDef = existing.entityDefs.get('part')
    if (!partDef) {
      return { ...state, alreadyUpToDate: true }
    }

    // ── 1. Materialize the four new fields ──
    // Insert-only: every field already present is returned and skipped, so this
    // creates exactly the ones missing.
    await ensureCustomFields(db, organizationId, 'part', partDef.id, PART_FIELDS, existing, state)

    // ── 2. Retire `part_unit_price` ──
    const [retired] = await db
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, partDef.id),
          eq(schema.CustomField.systemAttribute, REMOVED_ATTR)
        )
      )
      .limit(1)

    let valuesRemoved = 0
    let viewsPruned = 0

    if (retired) {
      // `FieldValue_fieldId_CustomField_id_fk` is ON DELETE CASCADE, so this is
      // belt-and-braces — but an explicit delete gives a countable result and
      // matches how `057-remove-signature-visibility-field` does it.
      const deleted = await db
        .delete(schema.FieldValue)
        .where(eq(schema.FieldValue.fieldId, retired.id))
        .returning({ id: schema.FieldValue.id })
      valuesRemoved = deleted.length

      await db.delete(schema.CustomField).where(eq(schema.CustomField.id, retired.id))

      viewsPruned = await pruneRetiredFieldFromViews(db, organizationId, partDef.id, retired.id)
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && !retired && viewsPruned === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 100 applied', {
        organizationId,
        addedAttrs: ADDED_ATTRS.length,
        fieldsCreated: state.fieldsCreated,
        removedField: retired?.id ?? null,
        valuesRemoved,
        viewsPruned,
      })

      await populateProvenance(organizationId)
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Strip the retired field from every `TableView` belonging to the part def.
 *
 * Matches BOTH spellings an id can appear under: the bare `CustomField.id` and
 * the composed `resourceFieldId` (`<entityDefinitionId>:<fieldId>`). Which one a
 * given config holds depends on when and by what the view was written, so
 * matching only one keyspace would silently leave half the rows dangling.
 *
 * @returns How many view rows were rewritten
 */
async function pruneRetiredFieldFromViews(
  db: Database,
  organizationId: string,
  partDefId: string,
  retiredFieldId: string
): Promise<number> {
  const spellings = [retiredFieldId, `${partDefId}:${retiredFieldId}`]

  // Panel/dialog views key `tableId` on the bare def id; table/kanban views use
  // the `entity-<defId>` form. Both are matched rather than parsed.
  const views = await db
    .select({ id: schema.TableView.id, config: schema.TableView.config })
    .from(schema.TableView)
    .where(
      and(
        eq(schema.TableView.organizationId, organizationId),
        inArray(schema.TableView.tableId, [partDefId, `entity-${partDefId}`])
      )
    )

  let pruned = 0
  for (const view of views) {
    const { config, changed } = pruneViewConfigFields(view.config, spellings)
    if (!changed) continue
    await db
      .update(schema.TableView)
      .set({ config, updatedAt: new Date() })
      .where(eq(schema.TableView.id, view.id))
    pruned++
  }

  return pruned
}

/**
 * Fill the three computed provenance fields for every part in the org.
 *
 * A full authoritative sweep, which also clears anything already stale: the
 * calculator's scope is every non-archived part, not the parts reachable through
 * the vendor/subpart graph, so a part with neither a supplier nor a bill of
 * materials is visited too. That is what makes a separate backfill pass
 * unnecessary.
 *
 * **The cache has to be flushed first.** The migration runner recomputes
 * `customFields` only AFTER `up()` returns, so the calculator would otherwise
 * resolve its fields against a cached map that predates this migration — it
 * would not see the three new fields at all, and would still see the one just
 * deleted.
 *
 * **Failure is logged, not fatal.** The schema change above is the migration;
 * populating derived numbers is a convenience that the next vendor-price or
 * subpart edit would do anyway. Failing the migration over it would block every
 * later migration for this org.
 */
async function populateProvenance(organizationId: string): Promise<void> {
  try {
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    const changed = await recalculateAllPartCosts(organizationId)
    logger.info('Populated part cost provenance', {
      organizationId,
      partsUpdated: changed.length,
    })
  } catch (error) {
    logger.error('Failed to populate part cost provenance — fields created, values not filled', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
