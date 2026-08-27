// packages/lib/src/resources/hooks/line-item-hooks.ts

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { isRecordId, type RecordId } from '../resource-id'
import type { SystemHook, SystemHookRegistry } from './types'

const logger = createScopedLogger('resources:line-item-hooks')

/**
 * Unwrap a write-time value that may be scalar or a single-element array, then read a
 * `RecordId` out of it. Relationship values reach a pre-hook as the `"<defId>:<instanceId>"`
 * string, but `values` is also accepted keyed by `field.id` OR by `systemAttribute`, and
 * some writers wrap the value in an array or in a `{ recordId }` object.
 */
function readRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return isRecordId(value) ? value : null
  if (value && typeof value === 'object' && 'recordId' in value) {
    const inner = (value as { recordId?: unknown }).recordId
    return typeof inner === 'string' && isRecordId(inner) ? inner : null
  }
  return null
}

/**
 * Read `catalog_item_part` off a catalog item.
 *
 * Three-state on purpose:
 * - a `RecordId` — the catalog item is backed by that part
 * - `null` — the catalog item resolved and is backed by NO part
 * - `undefined` — the part could not be resolved at all (the org has no
 *   `catalog_item_part` field, or the read failed). The caller must leave any existing
 *   stamp alone in that case; collapsing it into `null` would clear a good stamp on a
 *   transient failure.
 */
export async function resolveCatalogItemPart(params: {
  organizationId: string
  userId: string
  catalogItemRecordId: RecordId
}): Promise<RecordId | null | undefined> {
  const { organizationId, userId, catalogItemRecordId } = params

  try {
    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['catalog_item_part'] as const)
    if (!cf.catalog_item_part) return undefined

    const values = await new FieldValueService(organizationId, userId).getValues({
      recordId: catalogItemRecordId,
      fieldIds: [cf.catalog_item_part.id],
    })
    const entry = values.get(cf.catalog_item_part.id)
    const typed: TypedFieldValue | undefined = Array.isArray(entry) ? entry[0] : entry
    if (typed?.type === 'relationship' && typed.recordId) return typed.recordId
    return null
  } catch (error) {
    // A provenance stamp must never block the line write it rides on.
    logger.warn('could not resolve catalog_item_part — leaving line_item_part untouched', {
      organizationId,
      catalogItemRecordId,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Stamp `line_item_part` from the line's catalog item (08 §6.2).
 *
 * ⚠️ **Registered under `line_item_catalog_item`, NOT `line_item_part`.** `runPreHooks`
 * skips a hook on UPDATE unless its own registered systemAttribute is present in `values`
 * (`resources/crud/unified-handler.ts`). Keyed on `line_item_part` the stamp would fire on
 * create only and never when a line is re-pointed at a different catalog item — half the
 * feature. Keyed on the catalog item it fires on create and on every catalog-item change,
 * and on nothing else.
 *
 * That "nothing else" is the whole point. The `line_item → catalog_item → part` chain is
 * LIVE: re-pointing `catalog_item.part` later would silently re-attribute every historical
 * sale that ever went through that catalog item. This stamp is therefore FROZEN — it is
 * written when the line's catalog item is written and never re-derived, which is the same
 * answer Gap C §3.2 reached for `partKind`.
 *
 * Rules:
 * - The field stays writable. An explicit `line_item_part` in the SAME write wins — that is
 *   the human override, and a line that sells a part directly sets it itself.
 * - A catalog item with no part CLEARS the stamp on update. The line now sells something
 *   with no part behind it, and a stale stamp pointing at the previous catalog item's part
 *   is worse than no stamp: it is wrong, and it is wrong in the reporting join this field
 *   exists to serve. On create there is nothing to clear, so nothing is written.
 * - `line_item_part` is deliberately NOT in `LINE_TRIGGER_ATTRS` (`money/totals-hooks.ts`),
 *   so this stamp never fires a document total recompute. The part is provenance and
 *   grouping, never a pricing input (08 §7.2 correction 1).
 */
const stampPartFromCatalogItem: SystemHook = async ({
  operation,
  field,
  values,
  organizationId,
  userId,
  allFields,
}) => {
  const partField = allFields.find((f) => f.systemAttribute === 'line_item_part')
  if (!partField) return values

  // The human override: the caller is setting the part itself in this operation.
  if (partField.id in values || 'line_item_part' in values) return values

  const catalogKey = field.id in values ? field.id : (field.systemAttribute ?? '')
  if (!(catalogKey in values)) return values

  const catalogItemRecordId = readRecordId(values[catalogKey])
  const part = catalogItemRecordId
    ? await resolveCatalogItemPart({ organizationId, userId, catalogItemRecordId })
    : null

  if (part === undefined) return values
  if (part === null && operation === 'create') return values

  return { ...values, [partField.id]: part }
}

/**
 * System hooks for `line_item`.
 *
 * ⚠️ Registering the file is not enough — `HOOKS_BY_ENTITY_TYPE` in `system-hooks.ts`
 * returns `{}` for an unregistered entity type rather than failing, which is exactly how
 * `order_number` stayed NULL for three PRs (08 status block).
 */
export const LINE_ITEM_HOOKS: SystemHookRegistry = {
  line_item_catalog_item: [stampPartFromCatalogItem],
}
