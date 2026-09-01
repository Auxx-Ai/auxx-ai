// packages/lib/src/resources/events/captured-values.ts

import { parseRecordId, type RecordId } from '@auxx/types/resource'

/**
 * Reduce a field value to the scalar a hook should compare against, whatever
 * shape the chain that fired it hands over.
 *
 * 🛑 **Three chains hand a hook three DIFFERENT shapes for the same field, and
 * that is the whole reason this module exists rather than being inlined.** Two
 * of them were documented on `unwrapStatusValue` when #1940 fixed the update
 * chain (2026-08-27); the third was not, and #1995 shipped a delete guard four
 * days later that read the undocumented one as a bare string and was therefore
 * inert (`plans/money/tasks/24-captured-value-shape.md`).
 *
 * | chain | fire point | SINGLE_SELECT arrives as | RELATIONSHIP arrives as |
 * | --- | --- | --- | --- |
 * | system hook | `UnifiedCrudHandler.runPreHooks` | `'issued'`, sometimes `['issued']` | `'defId:instId'` |
 * | field pre-hook | `fireFieldPreHooks`, after `validateAndConvertValue` | `{type:'option', optionId}` | `{type:'relationship', recordId}` |
 * | **capture** | `captureEventData` — feeds pre-delete hooks, post-delete hooks AND the lifecycle event the worker consumes | **`['issued']`** | **`['defId:instId']`** |
 *
 * The capture chain arrays **every** `ARRAY_RETURN_FIELD_TYPES` member
 * (`SINGLE_SELECT`, `MULTI_SELECT`, `TAGS`, `RELATIONSHIP`, `FILE`) regardless
 * of how many values are stored, so a to-one relation is still an array of one.
 * A create/update event, by contrast, threads the caller's own input, where the
 * same field is a bare string. Any reader that handles one shape and not the
 * other passes silently — it does not throw, it just never matches.
 *
 * ⚠️ **A `typeof value === 'string'` test on a captured SINGLE_SELECT or
 * RELATIONSHIP is always false.** That reads correctly in review and passes any
 * unit test built from a hand-written string fixture, which is exactly how this
 * has now shipped twice.
 */
export function unwrapStatusValue(raw: unknown): unknown {
  if (Array.isArray(raw)) return unwrapStatusValue(raw[0])
  if (raw && typeof raw === 'object') {
    if ('optionId' in raw) return (raw as { optionId: unknown }).optionId
    if ('value' in raw) return (raw as { value: unknown }).value
  }
  return raw
}

/**
 * A captured relation, reduced to one entity instance id.
 *
 * Accepts every shape in {@link unwrapStatusValue}'s table plus the
 * `{type:'relationship', recordId}` envelope, and unwraps a `defId:instId`
 * RecordId to its instance half — a relation is stored as a RecordId on the
 * capture chain and as a bare instance id on some create paths, and callers
 * want the instance id either way.
 *
 * @returns the entity instance id, or `undefined` when the relation is unset.
 */
export function unwrapRelationId(raw: unknown): string | undefined {
  const unwrapped = unwrapRecordIdEnvelope(raw)
  if (typeof unwrapped !== 'string' || unwrapped.length === 0) return undefined
  return unwrapped.includes(':') ? parseRecordId(unwrapped as RecordId).entityInstanceId : unwrapped
}

/**
 * Every entity instance id in a captured to-many relation, de-duplicated.
 *
 * ⚠️ Use this, not {@link unwrapRelationId}, wherever the field can hold more
 * than one value — `unwrapRelationId` takes the first and silently drops the
 * rest, which is correct for a to-one relation and a bug for a to-many one.
 */
export function unwrapRelationIds(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw]
  const ids = values.map((value) => unwrapRelationId(value)).filter((id): id is string => !!id)
  return [...new Set(ids)]
}

/** One level of envelope removal, shared by the two relation readers. */
function unwrapRecordIdEnvelope(raw: unknown): unknown {
  if (Array.isArray(raw)) return unwrapRecordIdEnvelope(raw[0])
  if (raw && typeof raw === 'object') {
    if ('recordId' in raw) return (raw as { recordId: unknown }).recordId
    if ('optionId' in raw) return (raw as { optionId: unknown }).optionId
    if ('value' in raw) return (raw as { value: unknown }).value
  }
  return raw
}
