// packages/lib/src/field-hooks/post/part-kind-derivation.ts

/**
 * Derive `part_kind` from the bill of materials
 * (plans/money/tasks/23-build-from-the-part.md §4).
 *
 * **The second a part has a bill of materials, it is a subassembly.**
 *
 * ## Why the field is derived rather than remembered
 *
 * `part_kind` holds no information the subpart graph does not already hold.
 * Cross-tabbed across all 244 parts of the one org where a human ever set it,
 * 2026-08-31: BOM + somebody's subpart => `subassembly` 22/22; BOM + nobody's
 * subpart => `finished_good` 21/21; no BOM => `component` 201/201. **244 for
 * 244, zero exceptions.** The other four orgs have it NULL on every part, and 4
 * of those parts carry a real BOM — so in four orgs of five a genuine assembly
 * could not be built, and the refusal told the user to go set a field.
 *
 * That is what made the gate in `createBuild` misfire rather than protect:
 * `resolvePartKind` reads NULL as `component`, and `part-fields.ts` ships
 * `defaultValue: COMPONENT`, so a stored `component` never proved a human typed
 * it. Deriving the value restores the gate's meaning exactly where the gate is
 * applied — after this, a `component` on a part that HAS a BOM is somebody
 * having deliberately overridden the rule, and refusing it is correct.
 *
 * ## 🛑 Promotion to `subassembly` only, never to `finished_good`
 *
 * The full two-predicate derivation (*has a BOM and is nobody's subpart =>
 * finished good*) does not work, because the second predicate is unstable at
 * write time. People build bottom-up: the subassembly is nobody's subpart at the
 * instant it gets its own BOM, so the rule would stamp `finished_good`, and
 * adding it to a parent's BOM a minute later would mean *demoting* it.
 *
 * Demotion is the one move with a ledger consequence. `finished_good` is the
 * only kind that maps to `INVENTORY_FINISHED_GOODS`, and `complete-build.ts`
 * stamps the produce row from the produced part's kind on every completion, so
 * an unrelated BOM edit would silently move where a part posts from then on.
 * Frozen history is safe — every movement field is `updatable: false` — but
 * every future build is not.
 *
 * Promotion to `subassembly` changes nothing anybody has to be careful about:
 * `component` and `subassembly` map to the SAME account
 * (`INVENTORY_RAW_MATERIALS`), it turns on `absorbsConversionCost` which is
 * correct for anything with a BOM, and it makes the part buildable.
 * `finished_good` keeps its own derivation, `shouldSuggestFinishedGood`, gated
 * on product membership rather than on the BOM: the BOM says *we make this*,
 * a product says *we sell this*.
 *
 * ## The three decisions
 *
 * 1. **Promotion only.** A stored `subassembly` or `finished_good` is never
 *    overwritten. This fills an unclassified part in; it does not adjudicate a
 *    classified one.
 * 2. **No demotion on `mfg-subparts-deleted`.** A subassembly whose last subpart
 *    was removed is a data question, and auto-reverting would silently restate
 *    its standard cost. This rule is registered on `created` alone.
 * 3. **The purchased assembly whose BOM is kept for spares** gets promoted and
 *    starts absorbing conversion cost it never incurred. `part_kind` stays
 *    `updatable: true`, so a human sets it back to `component` and decision 1
 *    means it stays back. That override is the right answer to the one case the
 *    derivation gets wrong, which is why 🛑 **`part_kind` must NOT be made
 *    `computed: true`** — locking it removes the escape hatch this rests on.
 */

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { buildFieldValueKey, type FieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache, requireCachedEntityDefId } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import type { FieldValueUpdateEntry } from '../../realtime'
import { getRealtimeService, publishFieldValueUpdates } from '../../realtime'
import { PartKind } from '../../resources/registry/enum-values'

const logger = createScopedLogger('field-hooks:part-kind')

/**
 * Decide what a stored `part_kind` becomes now that the part has a BOM.
 *
 * Pure, and the ONE definition of the rule — the backfill in entity migration
 * 117 calls this same function, so a part promoted at write time and a part
 * promoted by the migration cannot be promoted by two different rules.
 *
 * `null` in means unset. `'promote'` is the only action; everything else is
 * `'leave'`, including a value this codebase does not recognise (an org that
 * added a fourth kind owns it, exactly as `resolvePartKind` assumes).
 */
export function resolvePartKindPromotion(stored: string | null | undefined): 'promote' | 'leave' {
  if (stored == null || stored === '' || stored === PartKind.COMPONENT) return 'promote'
  return 'leave'
}

/**
 * Promote every unclassified parent in a batch of new subpart edges.
 *
 * Shaped like `recalculatePartCostForEntityBatch` beside it and for the same
 * reason: on a bulk BOM import this is one lookup and one write pass rather
 * than one of each per edge. The parent is read from the threaded create values
 * first and only falls back to a query for the edges that did not carry it.
 *
 * 🛑 **Registered BEFORE the cost recalc on `mfg-subparts-created`.** The recalc
 * ends in `ensureFirstStandardCosts`, and `absorbsConversionCost` is false for a
 * `component` — so a roll that ran before the promotion would freeze a standard
 * with no labour or overhead in it, on exactly the parts this rule exists to
 * make buildable.
 *
 * Never throws. This is post-commit work hanging off a subpart write, and the
 * subpart is the fact the user asked to record: the worst case here is a part
 * that stays unclassified, which is the state it was in a moment ago.
 */
export async function derivePartKindForSubpartBatch(params: {
  organizationId: string
  records: Array<{ entityInstanceId: string; values?: Record<string, unknown> }>
}): Promise<void> {
  const { organizationId, records } = params
  if (records.length === 0) return

  try {
    const { unwrapRelationId } = await import('../../resources/events/captured-values')

    const parentIds = new Set<string>()
    const missing: string[] = []
    for (const { entityInstanceId, values } of records) {
      const fromValues = values ? unwrapRelationId(values.subpart_parent_part) : undefined
      if (fromValues) parentIds.add(fromValues)
      else missing.push(entityInstanceId)
    }

    if (missing.length > 0) {
      const { batchResolveSubpartParentIds } = await import('./part-kind-queries')
      for (const id of await batchResolveSubpartParentIds(organizationId, missing)) {
        parentIds.add(id)
      }
    }

    if (parentIds.size === 0) {
      logger.warn('Could not resolve any parent part for kind derivation', {
        organizationId,
        recordCount: records.length,
      })
      return
    }

    await promoteUnclassifiedParts(organizationId, [...parentIds])
  } catch (error) {
    logger.warn('Part kind derivation failed after a subpart write', {
      organizationId,
      recordCount: records.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Write `subassembly` onto every part in `partIds` that is unset or
 * `component`, and announce the change.
 *
 * Exported for the migration's backfill, which needs the same write against a
 * set of parts it resolved itself, on the connection the migration runs on.
 * Returns the ids actually promoted.
 */
export async function promoteUnclassifiedParts(
  organizationId: string,
  partIds: string[],
  db: Database = database
): Promise<string[]> {
  if (partIds.length === 0) return []

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['part_kind'] as const)
  const kindField = fields.part_kind
  if (!kindField) {
    logger.warn('No part_kind field in this org; nothing to derive', { organizationId })
    return []
  }

  const { readPartKinds } = await import('../../builds/build-queries')
  const stored = await readPartKinds(db, organizationId, partIds)

  const toPromote = [...new Set(partIds)].filter(
    (partId) => resolvePartKindPromotion(stored.get(partId) ?? null) === 'promote'
  )
  if (toPromote.length === 0) return []

  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const ctx = createFieldValueContext(organizationId, undefined, db)
  const fieldType = toFieldType(kindField.type)
  const entries: FieldValueUpdateEntry[] = []

  for (const partId of toPromote) {
    const recordId = toRecordId(partDefId, partId) as RecordId
    await setValueWithType(ctx, {
      recordId,
      fieldId: kindField.id,
      fieldType,
      value: { type: 'option', optionId: PartKind.SUBASSEMBLY },
    })
    entries.push({
      key: buildFieldValueKey(recordId, kindField.id as FieldId),
      value: { type: 'option', optionId: PartKind.SUBASSEMBLY },
    })
  }

  // 🛑 try/catch around the SERVICE lookup, not only the publish. `getRealtimeService`
  // constructs a Pusher provider on first use, and migration 117 calls this from the
  // entity-migration runner — a context with no realtime credentials configured. A
  // missed frame costs an open drawer a repaint; a throw here would abort a backfill
  // whose write has already landed.
  try {
    await publishFieldValueUpdates(getRealtimeService(), organizationId, entries)
  } catch (error) {
    logger.warn('Could not announce the part kind promotion', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info('Promoted parts to subassembly from their bill of materials', {
    organizationId,
    considered: partIds.length,
    promoted: toPromote.length,
  })

  return toPromote
}
