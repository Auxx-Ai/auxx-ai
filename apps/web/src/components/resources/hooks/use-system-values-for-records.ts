// apps/web/src/components/resources/hooks/use-system-values-for-records.ts

import { formatToRawValue, isMultiValueFieldType } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { getDefinitionId } from '@auxx/lib/resources/client'
import type { FieldReference, FieldValueKey } from '@auxx/types/field'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import { type CustomFieldValueState, useFieldValueStore } from '../store/field-value-store'
import { useResourceStore } from '../store/resource-store'
import { buildCanonicalFieldValueKey } from '../utils/canonicalize-field-ref'
import { useNormalizedRecordIds, usePrefixEpoch } from '../utils/normalize-record-id'
import { resolveSystemAttributeRef } from '../utils/resolve-system-attribute'

/** Options for {@link useSystemValuesForRecords}. */
interface UseSystemValuesForRecordsOptions {
  /** When true, batch-fetch any values missing from the store. */
  autoFetch?: boolean
  /** When false, skips all lookups and returns empty. */
  enabled?: boolean
}

/** Empty results, shared so a disabled hook returns stable references. */
const EMPTY_VALUES: Record<string, Record<string, unknown>> = {}
const EMPTY_LOADED: Record<string, Partial<Record<string, boolean>>> = {}

/**
 * The plural of `useSystemValues`: read the same system attributes across MANY
 * records in one subscription.
 *
 * Exists because some answers are only visible across a whole list. The
 * Suppliers tab has to know which supplier offer wins to mark it, and a row
 * that subscribes to its own values can never see its siblings; the same is
 * true of "how many components have no cost" on the Subparts tab. Calling
 * `useSystemValues` in a loop is not an option — hooks cannot be called per
 * item — so the read has to be lifted to the owner of the list.
 *
 * This is strictly cheaper than the per-row hooks it replaces, not an extra
 * cost: every value already lives in one zustand store keyed by
 * `FieldValueKey`, so this is a single shallow subscription over N keys instead
 * of N subscriptions over one key each, and the auto-fetch goes out as one
 * batch rather than N queued singles.
 *
 * Attributes resolve against **each record's own definition**, exactly as the
 * singular hook does — a bare name can belong to two definitions, and resolving
 * without one reads the wrong field.
 *
 * @returns `valuesById`, keyed by the record's normalized `RecordId`, plus
 * `loadedById` — see below, it is the difference between "no value" and "not
 * fetched yet".
 */
export function useSystemValuesForRecords<T extends string>(
  recordIds: RecordId[],
  systemAttributes: readonly T[],
  options: UseSystemValuesForRecordsOptions = {}
): {
  valuesById: Record<string, Record<T, unknown>>
  /**
   * Whether a given (record, attribute) has actually been READ, as opposed to
   * having no value.
   *
   * Both arrive as `undefined` in `valuesById`, and the difference matters
   * whenever absence is the signal: counting "components with no cost" off
   * unfetched values reports every component as uncosted on first paint. The
   * fetch queue null-backfills every key it requests, so a raw `undefined`
   * means not-yet-fetched and a raw `null` means genuinely empty — this map is
   * that distinction, surfaced.
   */
  loadedById: Record<string, Partial<Record<T, boolean>>>
  isLoading: boolean
} {
  const { autoFetch = false, enabled = true } = options

  const systemAttributeMap = useResourceStore((state) => state.systemAttributeMap)
  const systemAttributeByDef = useResourceStore((state) => state.systemAttributeByDef)
  const ambiguousSystemAttributes = useResourceStore((state) => state.ambiguousSystemAttributes)
  const fieldMap = useResourceStore((state) => state.fieldMap)

  const normalizedIds = useNormalizedRecordIds(recordIds)
  const epoch = usePrefixEpoch()

  // Callers pass inline array literals, which are new references every render.
  // Key the memos on contents so a re-render does not rebuild every canonical
  // key and re-trigger the batch fetch.
  const attrsKey = JSON.stringify(systemAttributes)
  const idsKey = normalizedIds.join(',')

  /**
   * One entry per (record, resolvable attribute), carrying the canonical store
   * key to subscribe on. Attributes that do not resolve for a record are
   * dropped rather than represented as undefined — the caller sees a missing
   * key, which is the same thing the singular hook does.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: attrsKey/idsKey stand in for the arrays; epoch invalidates store-derived results
  const entries = useMemo(() => {
    if (!enabled) return []
    const maps = { systemAttributeMap, systemAttributeByDef, ambiguousSystemAttributes }
    const result: {
      recordId: RecordId
      attr: T
      key: FieldValueKey
      canonicalRecordId: RecordId
      canonicalRef: FieldReference
      fieldType: string
      options?: unknown
    }[] = []

    for (const recordId of normalizedIds) {
      const entityDefinitionId = getDefinitionId(recordId)
      for (const attr of systemAttributes) {
        const resourceFieldId = resolveSystemAttributeRef(maps, attr, entityDefinitionId)
        if (!resourceFieldId) continue
        const field = fieldMap[resourceFieldId]
        if (!field?.fieldType) continue
        const canonical = buildCanonicalFieldValueKey(recordId, resourceFieldId)
        if (!canonical.key) continue
        result.push({
          recordId,
          attr,
          key: canonical.key,
          canonicalRecordId: canonical.recordId,
          canonicalRef: canonical.fieldRef,
          fieldType: field.fieldType,
          options: field.options,
        })
      }
    }
    return result
  }, [
    enabled,
    attrsKey,
    idsKey,
    epoch,
    systemAttributeMap,
    systemAttributeByDef,
    ambiguousSystemAttributes,
    fieldMap,
  ])

  // One shallow subscription across every key, so the list re-renders when any
  // of its records changes — including a realtime push from another session.
  const rawValues = useFieldValueStore(
    useShallow((state: CustomFieldValueState) => {
      const result: Record<string, unknown> = {}
      for (const entry of entries) {
        result[entry.key] = state.values[entry.key]
      }
      return result
    })
  )

  const isLoading = useFieldValueStore((state: CustomFieldValueState) => {
    for (const entry of entries) {
      if (entry.key in state.fetchingKeys) return true
    }
    return false
  })

  // Batch-queue once per (records + attributes + prefix-map) combination. The
  // queue deduplicates internally, so overlapping lists cost nothing extra.
  const queuedKeyRef = useRef<string>('')

  useLayoutEffect(() => {
    if (!autoFetch || entries.length === 0) return

    const requestKey = `${idsKey}:${attrsKey}:${epoch}`
    if (queuedKeyRef.current === requestKey) return
    queuedKeyRef.current = requestKey

    fieldValueFetchQueue.queueFetchBatch(
      entries.map((entry) => ({ recordId: entry.canonicalRecordId, fieldRef: entry.canonicalRef }))
    )
  }, [autoFetch, entries, idsKey, attrsKey, epoch])

  const { valuesById, loadedById } = useMemo(() => {
    if (entries.length === 0) {
      return {
        valuesById: EMPTY_VALUES as Record<string, Record<T, unknown>>,
        loadedById: EMPTY_LOADED as Record<string, Partial<Record<T, boolean>>>,
      }
    }
    const result: Record<string, Record<T, unknown>> = {}
    const loaded: Record<string, Partial<Record<T, boolean>>> = {}
    for (const entry of entries) {
      const bucket = (result[entry.recordId] ??= {} as Record<T, unknown>)
      const loadedBucket = (loaded[entry.recordId] ??= {})
      const raw = rawValues[entry.key]
      loadedBucket[entry.attr] = raw !== undefined
      const formatted =
        raw !== undefined ? formatToRawValue(raw as never, entry.fieldType as never) : undefined
      // Same collapse the singular hook applies: SINGLE_SELECT and single-value
      // ACTOR arrive as one-element arrays for uniform UI handling, so scalar
      // consumers get a scalar back. Genuinely multi-value types keep arrays.
      bucket[entry.attr] =
        Array.isArray(formatted) &&
        !isMultiValueFieldType(entry.fieldType as never, entry.options as never)
          ? formatted[0]
          : formatted
    }
    return { valuesById: result, loadedById: loaded }
  }, [entries, rawValues])

  return { valuesById, loadedById, isLoading }
}
