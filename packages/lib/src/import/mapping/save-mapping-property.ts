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
import {
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
        sourceColumnIndex: schema.ImportMappingProperty.sourceColumnIndex,
        sourceColumnName: schema.ImportMappingProperty.sourceColumnName,
        targetFieldKey: schema.ImportMappingProperty.targetFieldKey,
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
    }

    // An explicit value in the same call wins over both the preserve and the
    // clear, so "map this column to SKU and flag it as an identifier" is one mutation.
    if (input.identityRole !== undefined) {
      next.identityRole = sanitizeIdentityRole(input.identityRole) ?? undefined
    }
    if (input.mergeStrategy !== undefined) {
      next.mergeStrategy = input.mergeStrategy ?? undefined
    }
    // An unmapped column is never part of the match key, whatever was requested.
    if (unmapped) {
      next.identityRole = undefined
      next.mergeStrategy = undefined
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

    // The match key is per-JOB while the flag above is per-COLUMN. Recomputing it
    // in the same call as the column write is the only thing keeping them honest.
    await syncMappingIdentity(tx, input.mappingId)

    // Reset allowPlanGeneration since mappings changed - requires re-resolution
    await tx
      .update(schema.ImportJob)
      .set({ allowPlanGeneration: false, updatedAt: new Date() })
      .where(eq(schema.ImportJob.importMappingId, input.mappingId))
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
 * Then the flag is **defaulted ON** for the best mapped tier-1 identifier.
 * That is not polish, the entire defect class this code exists to fix comes
 * from the flag being absent, and shipping it unset reproduces the bug with
 * extra clicks.
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
  const identifierKey =
    input.preferredIdentifierFieldKeys?.find((key) => mappedKeys.has(key)) ?? null

  await db.transaction(async (tx) => {
    await lockMapping(tx, input.mappingId)

    for (const mapping of input.mappings) {
      // Built from scratch: auto-map re-decides every column's target, so nothing
      // stored against the previous target survives.
      const resolutionConfig = serializeResolutionConfig({
        options: mapping.options,
        relationConfig: mapping.relationConfig,
        identityRole:
          mapping.matchedFieldKey && mapping.matchedFieldKey === identifierKey
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
  })
}
