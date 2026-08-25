// packages/lib/src/import/resolution/get-select-create-counts.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { findCachedResource } from '../../cache'
import { mintOrMatchOptions } from '../../custom-fields/mint-options'
import { canGrowFieldOptions, fieldAllowsNewOptions } from '../../custom-fields/ownership'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import {
  type FieldOptionItem,
  getFieldOptions,
  optionMatchKey,
} from '../../resources/registry/option-helpers'
import type { Resource } from '../../resources/registry/types'
import type { ResolvedValue } from '../types/resolution'

/** A resolution row carrying a pending `select:create` label */
export interface PendingSelectCreateRow {
  /** `ImportValueResolution.id`, the row the minted option key is written back to */
  resolutionId: string
  /** `ImportJobProperty.id`, the column's per-job identity */
  jobPropertyId: string
  /** `ImportMappingProperty.sourceColumnIndex` */
  sourceColumnIndex: number
  /** CSV header, when the mapping recorded one */
  sourceColumnName: string | null
  /** `ImportMappingProperty.targetFieldKey` — a field's OUTPUT key, not its id */
  targetFieldKey: string
  /** `ImportMappingProperty.customFieldId`; null for system fields */
  customFieldId: string | null
  /** `ImportMapping.entityDefinitionId` — a CUID *or* a system slug */
  entityDefinitionId: string
  /** `ImportMapping.organizationId`, so a `(db, jobId)` caller needs no org argument */
  organizationId: string
  /** The raw cell, folded by {@link normalizeLabel}; the label an option is minted from */
  label: string
}

/** One field the job will grow, with every row that depends on it */
export interface SelectCreateGroup {
  /** `CustomField.id` of the field being grown — what `mintOrMatchOptions` locks */
  fieldId: string
  /** The column's `targetFieldKey`, kept for messages and the preview */
  targetFieldKey: string
  /** The field's display label, e.g. *"Category"* */
  fieldLabel: string
  /**
   * The field's option list as the ORG CACHE last saw it. Used only by the
   * `dryRun` preview; the real mint re-reads under its own row lock.
   */
  storedOptions: FieldOptionItem[]
  /** Distinct labels for this field, folded and in first-seen order */
  labels: string[]
  /** Every pending resolution row that resolves through this field */
  rows: PendingSelectCreateRow[]
}

/** Rows whose column may not grow its field, sharing one reason */
export interface RejectedSelectCreates {
  /** Human-readable reason, quoted into each row's error resolution */
  reason: string
  rows: PendingSelectCreateRow[]
}

/** What {@link groupSelectCreates} decided about a job's pending labels */
export interface SelectCreateGrouping {
  groups: SelectCreateGroup[]
  rejected: RejectedSelectCreates[]
}

/** One column's pending new options */
export interface SelectCreateColumnCount {
  /** `ImportJobProperty.id`, the column's per-job identity */
  jobPropertyId: string
  /** `ImportMappingProperty.sourceColumnIndex` */
  sourceColumnIndex: number
  /** CSV header, when the mapping recorded one */
  sourceColumnName: string | null
  /** The field the column writes into */
  targetFieldKey: string
  /** `CustomField.id` of that field */
  fieldId: string
  /** Distinct labels this column contributes that do NOT exist yet */
  labels: string[]
}

/** One field's pending new options */
export interface SelectCreateFieldCount {
  /** `CustomField.id` */
  fieldId: string
  /** The field's output key */
  targetFieldKey: string
  /** The field's display label, so the preview can say *"13 new Categories"* */
  fieldLabel: string
  /** Distinct labels that will be appended to this field's taxonomy */
  labels: string[]
}

/** Preview-facing summary of everything `select:create` will append */
export interface SelectCreateCounts {
  /** Distinct options that will be created across the whole job */
  total: number
  /** Per grown field — an option is per-field, so nothing dedupes across fields */
  byField: SelectCreateFieldCount[]
  /** Per mapped column, for a column-level *"3 new options"* note */
  byColumn: SelectCreateColumnCount[]
}

/**
 * Fold a raw cell to exactly the shape `mintOrMatchOptions`' own `cleanLabels`
 * produces: trimmed, inner whitespace collapsed, case preserved.
 *
 * Matching that folding is load-bearing. The minter returns `ids` positionally
 * against the labels it accepted, and it DROPS blanks and duplicates — so a
 * label it dropped would shift every id after it onto the wrong label. Sending
 * an already-folded, already-distinct list makes `cleanLabels` a no-op and the
 * alignment exact. {@link materializeSelectCreates} re-checks the length anyway.
 */
function normalizeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Read every `status: 'create'` resolution for a job and keep the ones that are
 * pending OPTION creates.
 *
 * The mirror image of `loadPendingCreates`: that one keeps the rows carrying a
 * `relationCreate` request, this one keeps the rows that do not. `select:create`
 * and `relation:create` both write `status: 'create'`, and the payload is the
 * only thing that tells them apart, so the two loaders partition the same rows
 * and can never both claim one.
 *
 * `ImportMapping` is joined for `entityDefinitionId` (which field list to look
 * the column's target up in) and `organizationId` (so {@link getSelectCreateCounts}
 * keeps a `(db, jobId)` signature).
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns One row per pending label, unresolved and ungrouped
 */
export async function loadPendingSelectCreates(
  db: Database,
  jobId: string
): Promise<PendingSelectCreateRow[]> {
  const rows = await db
    .select({
      resolutionId: schema.ImportValueResolution.id,
      jobPropertyId: schema.ImportJobProperty.id,
      sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
      sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
      targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
      customFieldId: schema.ImportMappingProperty.customFieldId,
      entityDefinitionId: schema.ImportMapping.entityDefinitionId,
      organizationId: schema.ImportMapping.organizationId,
      resolvedValues: schema.ImportValueResolution.resolvedValues,
    })
    .from(schema.ImportValueResolution)
    .innerJoin(
      schema.ImportJobProperty,
      eq(schema.ImportValueResolution.importJobPropertyId, schema.ImportJobProperty.id)
    )
    .innerJoin(
      schema.ImportMappingProperty,
      eq(schema.ImportJobProperty.importMappingPropertyId, schema.ImportMappingProperty.id)
    )
    .innerJoin(
      schema.ImportMapping,
      eq(schema.ImportMappingProperty.importMappingId, schema.ImportMapping.id)
    )
    .where(
      and(
        eq(schema.ImportJobProperty.importJobId, jobId),
        eq(schema.ImportValueResolution.status, 'create'),
        // A user override is a decided value, never a label to mint. Without
        // this, overriding a will-create value to an existing option leaves
        // `status: 'create'` behind (updateValueResolution never touches
        // status) and this loader mints a new option literally named the
        // chosen option's key — and an overridden RELATION create, whose
        // `relationCreate` marker the override erased, gets claimed by the
        // select materializer and rejected into a row error.
        isNull(schema.ImportValueResolution.userOverride)
      )
    )

  const pending: PendingSelectCreateRow[] = []
  for (const row of rows) {
    const values = row.resolvedValues as ResolvedValue[] | null
    const resolved = Array.isArray(values) ? values[0] : undefined
    // A relation create is the OTHER producer of `status: 'create'`; it carries
    // a `relationCreate` request and belongs to `materializeRelationCreates`.
    if (!resolved || resolved.relationCreate) continue
    if (typeof resolved.value !== 'string') continue
    const label = normalizeLabel(resolved.value)
    // Blank cells resolve to `{ type: 'value', value: null }` and never reach
    // `create`, but a column retargeted after planning could leave one behind.
    if (label === '') continue
    // A column with neither marker cannot be pointed at a field at all.
    if (!row.targetFieldKey && !row.customFieldId) continue
    pending.push({
      resolutionId: row.resolutionId,
      jobPropertyId: row.jobPropertyId,
      sourceColumnIndex: row.sourceColumnIndex,
      sourceColumnName: row.sourceColumnName,
      targetFieldKey: row.targetFieldKey ?? '',
      customFieldId: row.customFieldId,
      entityDefinitionId: row.entityDefinitionId,
      organizationId: row.organizationId,
      label,
    })
  }
  return pending
}

/** What one column's target field turned out to be, or why it is unusable. */
type ColumnDecision =
  | { fieldId: string; fieldLabel: string; storedOptions: FieldOptionItem[] }
  | { reason: string }

/**
 * Resolve one column's `CustomField` and answer whether it may be grown.
 *
 * `customFieldId` is set for custom fields and null for system fields, so the
 * lookup is the same dual convention `buildRecordData` and `execute-plan-job`
 * use: match on the id when there is one, on the OUTPUT key
 * (`systemAttribute ?? key`) otherwise. Either way the resource field's `id` IS
 * the `CustomField` row id, which is what the minter locks.
 *
 * A statically registered system resource has no `CustomField` row behind its
 * fields, and therefore no `fieldType`; the empty type falls out of
 * {@link canGrowFieldOptions}'s option-bearing check, so those columns are
 * rejected here rather than minting into a row that does not exist.
 */
async function decideColumn(
  organizationId: string,
  row: PendingSelectCreateRow,
  resources: Map<string, Resource | null>
): Promise<ColumnDecision> {
  let resource = resources.get(row.entityDefinitionId)
  if (resource === undefined) {
    // Tolerant lookup for the same reason `execute-plan-job` uses one: this id
    // is the bare entityType slug for a def-backed system type.
    resource = await findCachedResource(organizationId, row.entityDefinitionId)
    resources.set(row.entityDefinitionId, resource)
  }
  if (!resource) {
    return { reason: `The import target "${row.entityDefinitionId}" no longer exists.` }
  }

  const field = resource.fields.find((f) =>
    row.customFieldId ? f.id === row.customFieldId : getFieldOutputKey(f) === row.targetFieldKey
  )
  if (!field) {
    const named = row.targetFieldKey || row.customFieldId
    return { reason: `The field "${named}" no longer exists on ${resource.label}.` }
  }

  const type = String(field.fieldType ?? '')
  // The AUTHORITY half — may an automated writer grow this field at all. Both
  // halves come from `custom-fields/ownership`; the surface that OFFERS
  // `select:create` (`getImportableFields`' `canCreateOptions`) asks the exact
  // same pair, so what the wizard offers and what this refuses cannot drift.
  if (
    !canGrowFieldOptions({
      type,
      systemAttribute: field.systemAttribute,
      appInstallationId: field.appInstallationId,
      dataConnectorId: field.dataConnectorId,
    })
  ) {
    return { reason: `New options can't be added to "${field.label}" — it isn't user-managed.` }
  }
  // The PREFERENCE half — has the taxonomy been left open. Tri-state: TAGS grow
  // by default, select sets do not, and an explicit choice wins for either.
  if (
    !fieldAllowsNewOptions({
      type,
      options: field.options as { allowNewOptions?: boolean } | undefined,
    })
  ) {
    return { reason: `"${field.label}" doesn't accept new options from an import.` }
  }

  return {
    fieldId: String(field.id),
    fieldLabel: field.label,
    storedOptions: getFieldOptions(field),
  }
}

/**
 * Group pending labels by the `CustomField` they will be minted into, and sort
 * out the columns that may not mint at all.
 *
 * Grouping is by RESOLVED field id, not by column: two columns pointed at one
 * "Category" field must produce a single {@link mintOrMatchOptions} call, because
 * that call takes a row lock — N calls would be N lock acquisitions for one
 * outcome, and two of them racing would each miss the other's additions.
 *
 * A column that fails the authority gate rejects ITS rows, never the import.
 * An import-wide throw is the wrong blast radius for one bad column: the other
 * 39 columns are fine and the user can fix the field and re-run.
 *
 * @param organizationId - Owning org, scoping the resource lookup
 * @param rows - Pending rows from {@link loadPendingSelectCreates}
 * @returns The mintable groups plus the rejected rows and their reasons
 */
export async function groupSelectCreates(
  organizationId: string,
  rows: PendingSelectCreateRow[]
): Promise<SelectCreateGrouping> {
  const resources = new Map<string, Resource | null>()
  // A column always maps to exactly one field, so the decision is memoized per
  // column: a 5k-row file asks the org cache once per mapped column, not per row.
  const decisions = new Map<string, ColumnDecision>()
  const groups = new Map<string, SelectCreateGroup & { seen: Set<string> }>()
  const rejected = new Map<string, RejectedSelectCreates>()

  for (const row of rows) {
    let decision = decisions.get(row.jobPropertyId)
    if (!decision) {
      decision = await decideColumn(organizationId, row, resources)
      decisions.set(row.jobPropertyId, decision)
    }

    if ('reason' in decision) {
      const bucket = rejected.get(decision.reason)
      if (bucket) bucket.rows.push(row)
      else rejected.set(decision.reason, { reason: decision.reason, rows: [row] })
      continue
    }

    let group = groups.get(decision.fieldId)
    if (!group) {
      group = {
        fieldId: decision.fieldId,
        targetFieldKey: row.targetFieldKey,
        fieldLabel: decision.fieldLabel,
        storedOptions: decision.storedOptions,
        labels: [],
        rows: [],
        seen: new Set<string>(),
      }
      groups.set(decision.fieldId, group)
    }
    group.rows.push(row)
    // Folded, so `Steel` and `steel` in two columns contribute ONE label.
    const key = optionMatchKey(row.label)
    if (!group.seen.has(key)) {
      group.seen.add(key)
      group.labels.push(row.label)
    }
  }

  return {
    groups: [...groups.values()].map(({ seen: _seen, ...rest }) => rest),
    rejected: [...rejected.values()],
  }
}

/**
 * Count the options `select:create` will append, before anything is written —
 * the number the confirm step shows as *"will add 13 new Categories: Steel,
 * Plastic, …"*.
 *
 * The "is it new" decision is delegated to {@link mintOrMatchOptions}' `dryRun`
 * arm rather than compared here, so the preview folds labels onto existing
 * options EXACTLY the way the real run will. A second hand-rolled comparison
 * would drift the first time either side's folding changed, and the drift shows
 * up as a preview that promises options the run never creates.
 *
 * Fields that fail the authority gate contribute nothing: they create no
 * options, they error their rows.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Totals overall, per grown field, and per mapped column, with labels
 */
export async function getSelectCreateCounts(
  db: Database,
  jobId: string
): Promise<SelectCreateCounts> {
  const pending = await loadPendingSelectCreates(db, jobId)
  if (pending.length === 0) return { total: 0, byField: [], byColumn: [] }

  const organizationId = pending[0]?.organizationId ?? ''
  const { groups } = await groupSelectCreates(organizationId, pending)

  const byField: SelectCreateFieldCount[] = []
  const byColumn: SelectCreateColumnCount[] = []
  let total = 0

  for (const group of groups) {
    const { mintedLabels } = await mintOrMatchOptions(db, {
      fieldId: group.fieldId,
      organizationId,
      labels: group.labels,
      storedOptions: group.storedOptions,
      dryRun: true,
    })
    if (mintedLabels.length === 0) continue

    const isNew = new Set(mintedLabels.map(optionMatchKey))
    total += mintedLabels.length
    byField.push({
      fieldId: group.fieldId,
      targetFieldKey: group.targetFieldKey,
      fieldLabel: group.fieldLabel,
      labels: mintedLabels,
    })

    const columns = new Map<string, SelectCreateColumnCount & { seen: Set<string> }>()
    for (const row of group.rows) {
      const key = optionMatchKey(row.label)
      if (!isNew.has(key)) continue
      let column = columns.get(row.jobPropertyId)
      if (!column) {
        column = {
          jobPropertyId: row.jobPropertyId,
          sourceColumnIndex: row.sourceColumnIndex,
          sourceColumnName: row.sourceColumnName,
          targetFieldKey: row.targetFieldKey,
          fieldId: group.fieldId,
          labels: [],
          seen: new Set<string>(),
        }
        columns.set(row.jobPropertyId, column)
      }
      if (column.seen.has(key)) continue
      column.seen.add(key)
      column.labels.push(row.label)
    }
    byColumn.push(...[...columns.values()].map(({ seen: _seen, ...rest }) => rest))
  }

  return {
    total,
    byField,
    byColumn: byColumn.sort((a, b) => a.sourceColumnIndex - b.sourceColumnIndex),
  }
}
