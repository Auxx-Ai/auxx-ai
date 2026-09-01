// packages/lib/src/import/mapping/save-mapping-property.ts

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { SelectOption } from '@auxx/types/custom-field'
import { and, eq } from 'drizzle-orm'
import { BadRequestError, ConflictError } from '../../errors'
import {
  type IdentityRole,
  type ImportMergeStrategy,
  isImportMergeStrategy,
} from '../../write-policy'
import type { RelationConfig } from '../resolution/relation-policy'
import type { ResolutionConfig } from '../types/resolution'
import { syncMappingIdentity } from './derive-identifier-keys'
import { invalidateColumnResolutions } from './invalidate-column-resolutions'
import {
  isMatchRole,
  parseResolutionConfig,
  sanitizeIdentityRole,
  serializeResolutionConfig,
} from './resolution-config'

/**
 * Relation configuration for a mapping.
 *
 * Re-exported, NOT redeclared. This used to be a second, hand-written copy
 * of the same shape that `ResolutionConfig['relationConfig']` persists, and
 * the copy silently lacked `onNoMatch`/`linkMode`, so the policy had no way
 * through this mutation at all. One declaration, derived from the stored shape.
 *
 * `onNoMatch` / `linkMode` are per-column POLICY (03 §3.2, §3.4). They ride
 * the same mutation as the target itself so a policy change is one call, but
 * they are decided on the mapping ROW, not inside the field picker, which
 * closes on selection and would force a two-level re-navigation to change one
 * radio.
 */
export type { RelationConfig }

/** Input for saving a column mapping */
export interface SaveMappingInput {
  mappingId: string
  columnIndex: number
  targetFieldKey: string | null
  customFieldId: string | null
  resolutionType: string
  matchField?: string
  relationConfig?: RelationConfig
  options?: SelectOption[]
  /**
   * The identity flag. `{ kind: 'match' }` makes this column (part of) the match key.
   *
   * Tri-state on purpose: `undefined` leaves whatever is stored alone (so a
   * plain re-save of the resolution type does not silently clear the flag),
   * `null` clears it explicitly, a value sets it. Either way it is dropped
   * when the column is unmapped or retargeted, see {@link saveMappingProperty}.
   */
  identityRole?: IdentityRole | null
  /**
   * Per-column write policy on the UPDATE path. Same tri-state as
   * `identityRole`, and dropped on unmap/retarget for the same reason: it is a
   * policy about a specific TARGET FIELD, not about the source column.
   */
  mergeStrategy?: ImportMergeStrategy | null
  /**
   * The decimal separator this column's cells use, `.` or `,`. Same tri-state
   * as `mergeStrategy`: omit to keep what is stored, `null` to go back to
   * per-cell detection. It is how a column's cells are READ, so a change
   * invalidates the column's resolutions exactly like a resolution-type change.
   */
  numberDecimalSeparator?: '.' | ',' | null
  /**
   * The resource's declared NATURAL KEY, in leg order, when it declares one.
   *
   * Same set auto-map receives, and it is here for the case auto-map cannot
   * cover: a mapping the user REPAIRS by hand. Auto-map defaults the key on,
   * but only auto-map did, so every correction after it left the key off — and
   * a mis-mapped key column is exactly what sends the user to repair it. The
   * supplier-price importer shipped whole with `identifierFieldKeys: []` and
   * `defaultStrategy: 'create'` for that reason, which is a monthly price list
   * appending its 340 rows instead of updating them.
   *
   * See {@link applyNaturalKeyDefault} for when it is allowed to fire.
   */
  naturalKeyFieldKeys?: string[]
}

/** Minimal column shape for duplicate-target validation */
export interface MappedColumnRef {
  sourceColumnIndex: number
  sourceColumnName?: string | null
  targetFieldKey: string | null
}

/**
 * Reject a second column mapped to the same target field. Two columns feeding
 * one field used to be a SILENT last-mapping-wins drop in `buildRecordData` —
 * the earlier column's data vanished without a trace. Multi-column → one-field
 * mapping is not a feature; it is a validation error at mapping time.
 *
 * This is NOT a restriction on composite keys. A composite key is several
 * columns each flagged `match` on DIFFERENT fields, which this permits and which
 * is the entire point of `identifierFieldKeys` being an array.
 *
 * @throws ConflictError naming the already-mapped column
 */
export function assertNoDuplicateTargetMapping(
  existing: MappedColumnRef[],
  input: { columnIndex: number; targetFieldKey: string | null }
): void {
  if (!input.targetFieldKey) return
  const duplicate = existing.find(
    (m) => m.sourceColumnIndex !== input.columnIndex && m.targetFieldKey === input.targetFieldKey
  )
  if (duplicate) {
    const columnLabel = duplicate.sourceColumnName ?? `Column ${duplicate.sourceColumnIndex + 1}`
    throw new ConflictError(
      `"${columnLabel}" is already mapped to this field. Unmap it first — two columns cannot feed one field.`
    )
  }
}

/**
 * Defensive second gate behind the router's zod enum. `connector_owned_only` and
 * `manual_review` are connector-only, an import has no ownership ledger and no
 * drift queue, so neither has anything to mean here and neither may ever land on
 * an `ImportMappingProperty`.
 *
 * @throws BadRequestError naming the rejected value
 */
function assertImportMergeStrategy(value: ImportMergeStrategy | null | undefined): void {
  if (value === null || value === undefined) return
  if (!isImportMergeStrategy(value)) {
    throw new BadRequestError(
      `"${value}" is not a merge strategy the importer supports (overwrite, fill_blank, ignore).`
    )
  }
}

/**
 * Take the mapping's row lock for the rest of the transaction.
 *
 * **A transaction alone does not make these writes safe.** `syncMappingIdentity`
 * is a read-modify-write of `ImportMapping.identifierFieldKeys`, derived by
 * re-reading every column row. Under the default READ COMMITTED isolation two
 * concurrent column saves each read a column set that does not contain the
 * other's uncommitted flag, and the later commit overwrites the earlier one:
 * a lost update, not a torn write, so no amount of statement grouping fixes it.
 * The wizard fires these from per-row toggles, so that interleaving is ordinary.
 *
 * Serializing on the parent row is the whole fix. Every mapping write takes this
 * lock first and no path takes the column rows first, so the ordering cannot
 * deadlock.
 */
async function lockMapping(tx: Transaction, mappingId: string): Promise<void> {
  await tx
    .select({ id: schema.ImportMapping.id })
    .from(schema.ImportMapping)
    .where(eq(schema.ImportMapping.id, mappingId))
    .for('update')
}

/**
 * Default the declared NATURAL KEY back on after a per-column save.
 *
 * Auto-map already does this for the mapping it produces
 * ({@link batchUpdateMappingsFromAutoMap}); this is the same rule for the
 * mapping a user assembles or CORRECTS by hand, which auto-map never sees
 * again. Without it the two paths disagree: `vendor_part` has no lone
 * identifier at all, so a mapping repaired column by column ends up with no
 * match key and silently reverts to create-only.
 *
 * Three conditions, all narrow on purpose — a match key that reappears on its
 * own is worse than one that never showed up:
 *
 * 1. **The saved column is itself a leg.** An edit to an unrelated column must
 *    never resurrect a key, so only a write that could have COMPLETED the
 *    tuple is allowed to stamp it.
 * 2. **No identity outside the tuple.** A flag on any other field is the user's
 *    own answer and is never overridden. A flag on a leg is not — a HALF tuple
 *    is not an answer, it is the state that matches nothing, and unmapping one
 *    leg and re-mapping it is how a user lands in it. That case is completed
 *    rather than blocked.
 * 3. **Every leg is mapped.** All or nothing, for the reason
 *    {@link AutoMapUpdateInput.naturalKeyFieldKeys} gives: a partial tuple
 *    matches nothing, so half a key is strictly worse than none.
 *
 * The caller additionally skips this on an explicit `identityRole: null`, so
 * clearing the last flag stays a way to force create-only rather than a write
 * this function immediately undoes.
 */
async function applyNaturalKeyDefault(
  tx: Transaction,
  mappingId: string,
  naturalKeyFieldKeys: string[]
): Promise<void> {
  if (naturalKeyFieldKeys.length === 0) return

  const columns = await tx
    .select({
      id: schema.ImportMappingProperty.id,
      targetType: schema.ImportMappingProperty.targetType,
      targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
      resolutionConfig: schema.ImportMappingProperty.resolutionConfig,
    })
    .from(schema.ImportMappingProperty)
    .where(eq(schema.ImportMappingProperty.importMappingId, mappingId))

  const mapped = columns.filter((c) => c.targetFieldKey && c.targetType !== 'skip')

  const flagged = mapped
    .filter((c) => isMatchRole(parseResolutionConfig(c.resolutionConfig).identityRole))
    .map((c) => c.targetFieldKey)

  // Condition 2 — an identity of the user's own is never overridden.
  if (flagged.some((key) => !naturalKeyFieldKeys.includes(key!))) return
  // …and a tuple that is already whole needs no help.
  if (naturalKeyFieldKeys.every((key) => flagged.includes(key))) return

  // Condition 3 — every leg mapped, or nothing happens.
  const legs = naturalKeyFieldKeys.map((key) => mapped.find((c) => c.targetFieldKey === key))
  if (legs.some((leg) => !leg)) return

  const now = new Date()
  for (const leg of legs) {
    const config = parseResolutionConfig(leg!.resolutionConfig)
    await tx
      .update(schema.ImportMappingProperty)
      .set({
        resolutionConfig: serializeResolutionConfig({
          ...config,
          identityRole: { kind: 'match' },
        }),
        updatedAt: now,
      })
      .where(eq(schema.ImportMappingProperty.id, leg!.id))
  }
}

/**
 * Save a column mapping property.
 *
 * Also resets `allowPlanGeneration` (mappings changed ⇒ re-resolution) and
 * recomputes the parent `ImportMapping.identifierFieldKeys` + mode. All of it
 * runs in ONE transaction under the mapping's row lock, see {@link lockMapping}.
 *
 * **Clearing is as load-bearing as setting.** The identity flag lives on the COLUMN
 * while the match key lives on the JOB, so nothing keeps them in sync when a
 * column is unmapped or pointed at a different field. Both drop the flag here:
 * a stale key whose field has no mapped column makes `analyzeRow` find no
 * identifier value and the import silently reverts to create-only behind a
 * wizard that says update is on.
 *
 * @param db - Database instance
 * @param input - Mapping input
 */
export async function saveMappingProperty(db: Database, input: SaveMappingInput): Promise<void> {
  assertImportMergeStrategy(input.mergeStrategy)

  await db.transaction(async (tx) => {
    await lockMapping(tx, input.mappingId)

    // One read for both the merge base and the duplicate-target guard. The two
    // used to be separate queries with complementary predicates over the same
    // rows; a mapping has one row per CSV column, so reading them all and
    // partitioning here is the same answer for less work.
    //
    // `resolutionConfig` is MERGED, not rebuilt. Rebuilding it from scratch is
    // what would drop `identityRole`/`mergeStrategy` on any save that did not
    // happen to resend them.
    const columns = await tx
      .select({
        id: schema.ImportMappingProperty.id,
        sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
        sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
        targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
        resolutionType: schema.ImportMappingProperty.resolutionType,
        resolutionConfig: schema.ImportMappingProperty.resolutionConfig,
      })
      .from(schema.ImportMappingProperty)
      .where(eq(schema.ImportMappingProperty.importMappingId, input.mappingId))

    const current = columns.find((column) => column.sourceColumnIndex === input.columnIndex)

    // Duplicate-target guard: two columns must never feed one field. The guard
    // already skips this column and only matches a non-null target, so the
    // unfiltered set is exactly what it wants.
    assertNoDuplicateTargetMapping(columns, input)

    const stored = parseResolutionConfig(current?.resolutionConfig)
    const retargeted = (current?.targetFieldKey ?? null) !== input.targetFieldKey
    const unmapped = !input.targetFieldKey
    // How the column's cells are READ changed — `currency:major` → `number:integer`,
    // `select:value` → `select:create`. See {@link invalidateColumnResolutions}.
    const reinterpreted = (current?.resolutionType ?? null) !== input.resolutionType

    // `options` / `relationConfig` / `matchField` describe the TARGET FIELD and
    // are always resent by the caller, so they keep the pre-existing
    // build-from-input behaviour: preserving them across a retarget would carry a
    // different field's option list onto this column.
    // The relation POLICY (`matchField` / `onNoMatch` / `linkMode`) is preserved
    // across a plain re-save, exactly like `identityRole` and `mergeStrategy`, and
    // dropped on retarget/unmap for the same reason. Rebuilding it from input
    // alone would mean any caller that did not resend the whole config silently
    // reset the column's policy, the identical failure class as the flag-dropping
    // bug this function was rewritten to fix.
    const storedRelation = retargeted || unmapped ? undefined : stored.relationConfig
    const next: ResolutionConfig = {
      options: input.options,
      relationConfig: input.relationConfig
        ? {
            ...input.relationConfig,
            // An explicit top-level `matchField` wins, then the one on the config,
            // then the stored one. Never let it fall to undefined, a
            // match-field-less relation column is the state the resolver cannot
            // resolve, and the row renders as if it were finished (Defect E).
            matchField:
              input.matchField ?? input.relationConfig.matchField ?? storedRelation?.matchField,
            onNoMatch: input.relationConfig.onNoMatch ?? storedRelation?.onNoMatch,
            linkMode: input.relationConfig.linkMode ?? storedRelation?.linkMode,
          }
        : undefined,
      // Preserve the policy fields, unless the target moved, in which case they
      // are about a field this column no longer feeds.
      identityRole: retargeted || unmapped ? undefined : stored.identityRole,
      mergeStrategy: retargeted || unmapped ? undefined : stored.mergeStrategy,
      numberDecimalSeparator: retargeted || unmapped ? undefined : stored.numberDecimalSeparator,
    }

    // An explicit value in the same call wins over both the preserve and the
    // clear, so "map this column to SKU and flag it as an identifier" is one mutation.
    if (input.identityRole !== undefined) {
      next.identityRole = sanitizeIdentityRole(input.identityRole) ?? undefined
    }
    if (input.mergeStrategy !== undefined) {
      next.mergeStrategy = input.mergeStrategy ?? undefined
    }
    if (input.numberDecimalSeparator !== undefined) {
      next.numberDecimalSeparator = input.numberDecimalSeparator ?? undefined
    }
    // A separator change reads every cell differently (`1,5` is 15 or 1.5),
    // so it invalidates the column like a resolution-type change does.
    const separatorChanged =
      (next.numberDecimalSeparator ?? null) !== (stored.numberDecimalSeparator ?? null)
    // An unmapped column is never part of the match key, whatever was requested.
    if (unmapped) {
      next.identityRole = undefined
      next.mergeStrategy = undefined
      next.numberDecimalSeparator = undefined
    }

    // Update the mapping property
    await tx
      .update(schema.ImportMappingProperty)
      .set({
        targetFieldKey: input.targetFieldKey,
        customFieldId: input.customFieldId,
        targetType: input.targetFieldKey ? 'particle' : 'skip',
        resolutionType: input.resolutionType,
        resolutionConfig: serializeResolutionConfig(next),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
          eq(schema.ImportMappingProperty.sourceColumnIndex, input.columnIndex)
        )
      )

    // Before the recompute, not after: this stamps the per-COLUMN flags that
    // `syncMappingIdentity` then derives the per-JOB key from. An explicit
    // clear in this same call is the user saying "no match key", so it is
    // never the write that triggers the default.
    if (input.identityRole !== null && input.targetFieldKey) {
      const naturalKey = input.naturalKeyFieldKeys ?? []
      if (naturalKey.includes(input.targetFieldKey)) {
        await applyNaturalKeyDefault(tx, input.mappingId, naturalKey)
      }
    }

    // The match key is per-JOB while the flag above is per-COLUMN. Recomputing it
    // in the same call as the column write is the only thing keeping them honest.
    await syncMappingIdentity(tx, input.mappingId)

    // Reset allowPlanGeneration since mappings changed - requires re-resolution
    await tx
      .update(schema.ImportJob)
      .set({ allowPlanGeneration: false, updatedAt: new Date() })
      .where(eq(schema.ImportJob.importMappingId, input.mappingId))

    // …and re-resolution only re-resolves what is not already cached. A column
    // pointed at a new field, or read as a different type, has to lose its rows
    // or the re-run is a no-op behind a control that looks like it worked.
    if (retargeted || reinterpreted || separatorChanged) {
      await invalidateColumnResolutions(tx, [current?.id])
    }
  })
}

/** Input for batch updating mappings from auto-map results */
export interface AutoMapUpdateInput {
  mappingId: string
  mappings: Array<{
    columnIndex: number
    matchedFieldKey: string | null
    customFieldId: string | null
    resolutionType: string
    options?: SelectOption[]
    /**
     * The second half of Defect E. This function used to write
     * `resolutionConfig = { options }` and drop `relationConfig` on the floor,
     * so an auto-mapped relation column reached the resolver with no target at
     * all and failed every row with "Relation target entity not configured",
     * behind a mapping row that rendered as a plain, finished-looking label.
     *
     * Auto-map now persists the full policy (`buildRelationColumnPolicy`),
     * including an EXPLICIT `matchField`, so nothing downstream depends on a
     * default being right.
     */
    relationConfig?: RelationConfig
  }>
  /**
   * Target field keys that deserve the identity flag by default, in preference order
   * (tier 1 only, `sku`/`email` before Record ID). The FIRST one that auto-map
   * actually mapped is flagged.
   *
   * Exactly one, never all of them: two flagged columns are a COMPOSITE key,
   * and a composite key is a deliberate user act, never a guess. Flagging every
   * mapped identifier would silently key a parts import on `(sku AND id)`, which
   * matches nothing.
   */
  preferredIdentifierFieldKeys?: string[]
  /**
   * The resource's declared NATURAL KEY, in leg order — the composite identity of
   * a join-shaped entity (`(part, supplier)` on `vendor_part`).
   *
   * This is the one composite key that is NOT a guess, which is why it may be
   * defaulted where {@link preferredIdentifierFieldKeys} deliberately picks only
   * one: the registry states that these fields together identify the record.
   *
   * **All or nothing.** It is applied only when EVERY leg was mapped. A partial
   * tuple can never match anything (`analyzeRow` requires every component), so
   * flagging half of one produces an import that reports `unmatched` for every
   * row behind a wizard that says update — strictly worse than flagging nothing
   * and staying create-only.
   */
  naturalKeyFieldKeys?: string[]
}

/**
 * Batch update mapping properties from auto-map results.
 *
 * Also resets `allowPlanGeneration` and recomputes the parent mapping's match
 * key + mode.
 *
 * Auto-map RETARGETS columns wholesale, so every stored `identityRole` is
 * dropped first: a flag left behind on a column that now feeds a different field
 * is exactly the stale-key failure `saveMappingProperty` guards against.
 *
 * Then the flag is **defaulted ON**: for every leg of the resource's declared
 * natural key when all of them were mapped, otherwise for the best mapped
 * tier-1 identifier. That is not polish, the entire defect class this code
 * exists to fix comes from the flag being absent, and shipping it unset
 * reproduces the bug with extra clicks.
 *
 * The per-column writes, the identity recompute and the `allowPlanGeneration`
 * reset are ONE transaction under the mapping's row lock. Auto-map retargets
 * every column at once, so a failure part way through used to leave the mapping
 * half pointed at the new targets and half at the old ones, with a match key
 * derived from the mixture.
 *
 * @param db - Database instance
 * @param input - Auto-map update input
 */
export async function batchUpdateMappingsFromAutoMap(
  db: Database,
  input: AutoMapUpdateInput
): Promise<void> {
  const now = new Date()

  const mappedKeys = new Set(
    input.mappings.map((m) => m.matchedFieldKey).filter((key): key is string => !!key)
  )

  // A fully mapped natural key wins outright: it is the resource's DECLARED
  // identity, not a heuristic pick. Partially mapped, it is dropped entirely
  // rather than degraded to its mapped legs — a widened key silently updates the
  // wrong record, which is the failure mode this whole path exists to remove.
  const naturalKey = input.naturalKeyFieldKeys ?? []
  const naturalKeyMapped = naturalKey.length > 0 && naturalKey.every((key) => mappedKeys.has(key))

  const identifierKeys = naturalKeyMapped
    ? new Set(naturalKey)
    : new Set(
        [input.preferredIdentifierFieldKeys?.find((key) => mappedKeys.has(key))].filter(
          (key): key is string => !!key
        )
      )

  await db.transaction(async (tx) => {
    await lockMapping(tx, input.mappingId)

    // Auto-map RETARGETS wholesale, so it is the widest producer of stale
    // resolutions there is. Read the pre-change state once and invalidate only
    // the columns it actually moved.
    const before = await tx
      .select({
        id: schema.ImportMappingProperty.id,
        sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
        targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
        resolutionType: schema.ImportMappingProperty.resolutionType,
      })
      .from(schema.ImportMappingProperty)
      .where(eq(schema.ImportMappingProperty.importMappingId, input.mappingId))

    const changedPropertyIds = input.mappings
      .filter((mapping) => {
        const current = before.find((c) => c.sourceColumnIndex === mapping.columnIndex)
        if (!current) return false
        return (
          (current.targetFieldKey ?? null) !== mapping.matchedFieldKey ||
          (current.resolutionType ?? null) !== mapping.resolutionType
        )
      })
      .map((mapping) => before.find((c) => c.sourceColumnIndex === mapping.columnIndex)?.id)

    for (const mapping of input.mappings) {
      // Built from scratch: auto-map re-decides every column's target, so nothing
      // stored against the previous target survives.
      const resolutionConfig = serializeResolutionConfig({
        options: mapping.options,
        relationConfig: mapping.relationConfig,
        identityRole:
          mapping.matchedFieldKey && identifierKeys.has(mapping.matchedFieldKey)
            ? { kind: 'match' }
            : undefined,
      })

      await tx
        .update(schema.ImportMappingProperty)
        .set({
          targetFieldKey: mapping.matchedFieldKey,
          customFieldId: mapping.customFieldId,
          targetType: mapping.matchedFieldKey ? 'particle' : 'skip',
          resolutionType: mapping.resolutionType,
          resolutionConfig,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
            eq(schema.ImportMappingProperty.sourceColumnIndex, mapping.columnIndex)
          )
        )
    }

    await syncMappingIdentity(tx, input.mappingId)

    // Reset allowPlanGeneration since mappings changed - requires re-resolution
    await tx
      .update(schema.ImportJob)
      .set({ allowPlanGeneration: false, updatedAt: now })
      .where(eq(schema.ImportJob.importMappingId, input.mappingId))

    await invalidateColumnResolutions(tx, changedPropertyIds)
  })
}
