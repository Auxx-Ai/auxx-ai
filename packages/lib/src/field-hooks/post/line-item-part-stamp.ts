// packages/lib/src/field-hooks/post/line-item-part-stamp.ts

import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import type { RecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { createFieldValueContext } from '../../field-values/field-value-helpers'
import { setValueWithType } from '../../field-values/field-value-mutations'
import { toFieldType } from '../../field-values/stored-field-type'
import { resolveCatalogItemPart } from '../../resources/hooks/line-item-hooks'
import type { EntityFieldChangeHandler } from '../types'

const logger = createScopedLogger('field-hooks:line-item-part-stamp')

/**
 * Read the catalog item `RecordId` out of a post-write relationship value.
 * RELATIONSHIP fields report the FULL array the write produced, and `null` when
 * the write cleared the only row.
 */
function readRelationshipRecordId(raw: unknown): RecordId | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value === 'string') return value as RecordId
  const typed = value as TypedFieldValue | undefined
  if (typed?.type === 'relationship' && typed.recordId) return typed.recordId
  return null
}

/**
 * Stamp `line_item_part` when a line's catalog item changes (08 §6.2, §7.5).
 *
 * ⚠️ **This is the SECOND door, and it is the one the UI actually uses.** The
 * `LINE_ITEM_HOOKS` system hook in `resources/hooks/line-item-hooks.ts` covers
 * writes that go through `UnifiedCrudHandler` (`record.create` / `createMany` /
 * `record.update`) — that is how the `LineBuilder` ADDS a line. But every EDIT to
 * an existing line goes through `useSaveFieldValue` → `fieldValue.set` /
 * `setBulk` → `FieldValueService`, and that path consults only
 * `getFieldPreHooks` / `getEntityFieldChangeHooks`. It never reads the system-hook
 * registry at all (the same bypass `invoice-hooks.ts` records for money's
 * lifecycle writers).
 *
 * Found by testing the real app: re-pointing a line at a catalog item that has a
 * part left `line_item_part` NULL, because re-pointing never reaches
 * `runPreHooks`. Without this handler the system hook's whole reason for being
 * keyed on `line_item_catalog_item` — so a re-point re-stamps — is unreachable
 * in the product.
 *
 * A field PRE-hook cannot do this: it may only transform the value of its own
 * field. Writing a different field is a post-write concern, which is why this is
 * an `EntityFieldChangeHandler`, registered beside `recomputeOnLineChange`.
 *
 * Semantics are identical to the system hook, deliberately — both call the same
 * `resolveCatalogItemPart`:
 * - catalog item with a part → stamp it (a re-point re-stamps; the chain is live,
 *   so the stamp is frozen against LATER edits to `catalog_item.part`, never
 *   against a change of which catalog item the line sells)
 * - catalog item with no part, or detached → clear the stamp
 * - could not resolve (unmigrated org, transient failure) → leave it alone
 *
 * No recursion: this fires only for `line_item_catalog_item`, and the value it
 * writes is `line_item_part`. That attribute is deliberately absent from
 * `LINE_TRIGGER_ATTRS`, so the write cannot move a document total either.
 */
export const stampPartOnCatalogItemChange: EntityFieldChangeHandler = async (event) => {
  if (event.field.systemAttribute !== 'line_item_catalog_item') return

  const { organizationId, userId, recordId } = event

  try {
    const cf = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['line_item_part'] as const)
    const partField = cf.line_item_part
    if (!partField) return

    const catalogItemRecordId = readRelationshipRecordId(event.newValue)
    const part = catalogItemRecordId
      ? await resolveCatalogItemPart({ organizationId, userId, catalogItemRecordId })
      : null

    // `undefined` is "could not resolve" — never clear a good stamp on a blip.
    if (part === undefined) return

    const ctx = await createFieldValueContext(organizationId, userId)
    await setValueWithType(ctx, {
      recordId,
      fieldId: partField.id,
      fieldType: toFieldType(partField.type),
      value: part ? { type: 'relationship', recordId: part } : null,
    })
  } catch (error) {
    // Provenance must never fail the line edit that triggered it.
    logger.warn('could not stamp line_item_part from the catalog item', {
      organizationId,
      recordId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
