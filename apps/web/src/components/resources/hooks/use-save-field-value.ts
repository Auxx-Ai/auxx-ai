// apps/web/src/components/resources/hooks/use-save-field-value.ts

import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'
import {
  coerceNameInput,
  type FieldOptions,
  formatToTypedInput,
  isArrayReturnFieldType,
  type NameParts,
  readNameParts,
} from '@auxx/lib/field-values/client'
import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import {
  getInverseFieldId,
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
} from '@auxx/types/custom-field'
import { type FieldId, type FieldReference, toResourceFieldId } from '@auxx/types/field'
import { toastError } from '@auxx/ui/components/toast'
import { getInverseCardinality } from '@auxx/utils'
import { useCallback } from 'react'
import {
  buildFieldValueKey,
  type FieldValueKey,
  type StoredFieldValue,
  useFieldValueStore,
} from '~/components/resources/store/field-value-store'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { getNormalizedRecordId } from '~/components/resources/utils/normalize-record-id'
import { resolveSystemAttributeForRecord } from '~/components/resources/utils/resolve-system-attribute'
import { api } from '~/trpc/react'
import {
  extractRelatedRecordIds,
  type InverseSyncInfo,
  useRelationshipSync,
} from './use-relationship-sync'

/** Optional save-time flags threaded through the save variants. */
interface SaveOptions {
  /** Request AI stage-1 generation. Server short-circuits and enqueues a
   *  BullMQ autofill job; the client keeps an optimistic 'generating' marker
   *  until the realtime socket delivers the final value. */
  ai?: boolean
  /**
   * Field options (`options.multi`, `actor.multiple`, …). Without them the
   * optimistic write and the post-save store shaping treat a multi-value
   * scalar field (EMAIL/URL/PHONE with `options.multi`) as scalar — the
   * optimistic store joins the array into one string, and clearing the field
   * leaves the store scalar-shaped instead of `[]`.
   */
  fieldOptions?: FieldOptions
}

/**
 * Resolve a field identifier to a FieldReference suitable for store key building.
 * If the identifier is a systemAttribute (e.g. 'vendor_part_vendor_sku'), returns
 * the corresponding ResourceFieldId (e.g. 'defId:vendorSku') so store keys match
 * what useSystemValues subscribes to. Otherwise returns the identifier as-is.
 *
 * `recordId` scopes the attribute to its own definition — without it a shared
 * attribute resolves to whichever definition won the bare map, and the store key
 * then disagrees with the one `useSystemValues` subscribes to.
 */
function resolveFieldRef(fieldId: string, recordId?: RecordId): FieldReference {
  const resourceFieldId = resolveSystemAttributeForRecord(
    useResourceStore.getState(),
    fieldId,
    recordId
  )
  return (resourceFieldId ?? fieldId) as FieldReference
}

/** Field metadata for relationship sync - uses raw RelationshipConfig */
interface FieldMetadata {
  type: string
  relationship?: RelationshipConfig
}

interface UseSaveFieldValueOptions {
  /** Optional callback after successful save */
  onSuccess?: () => void
  /** Optional field metadata provider for relationship sync */
  getFieldMetadata?: (fieldId: FieldId) => FieldMetadata | undefined
}

/** Result of optimistic update preparation */
interface OptimisticUpdatePrep {
  key: FieldValueKey
  mutationVersion: number
  typedValue: unknown
  inverseInfo: InverseSyncInfo | null
  oldRelatedRecordIds: RecordId[]
  newRelatedRecordIds: RecordId[]
}

/** Prepare optimistic update and capture rollback info */
function prepareOptimisticUpdate(
  recordId: RecordId,
  fieldId: FieldId,
  value: unknown,
  fieldType: FieldType,
  getFieldMetadata?: (fieldId: FieldId) => FieldMetadata | undefined,
  ai?: boolean,
  fieldOptions?: FieldOptions
): OptimisticUpdatePrep {
  const key = buildFieldValueKey(recordId, resolveFieldRef(fieldId, recordId))
  const store = useFieldValueStore.getState()

  // Capture old value for relationship sync rollback
  const oldValue = store.values[key]

  // Increment version BEFORE optimistic update (for race condition handling)
  const mutationVersion = store.incrementMutationVersion(key)

  // AI stage-1: clear the typed value optimistically; shimmer + sparkle
  // signal generation is in flight. The realtime stage-2 commit brings the
  // final value. On error, the value stays null (see handleMutationError).
  if (ai) {
    store.setAiStateOptimistic(key, 'generating', {
      requestedAt: new Date().toISOString(),
    })
    store.setValueOptimistic(key, null)
    return {
      key,
      mutationVersion,
      typedValue: null,
      inverseInfo: null,
      oldRelatedRecordIds: [],
      newRelatedRecordIds: [],
    }
  }

  // Optimistic update to store (convert to TypedFieldValue format).
  // `fieldOptions` matters for options.multi scalar fields: without it an
  // array value would be coerced through the scalar branch (joined string).
  const typedValue = fieldType ? formatToTypedInput(value, fieldType, { fieldOptions }) : value

  store.setValueOptimistic(key, typedValue)

  // Relationship sync prep
  let inverseInfo: InverseSyncInfo | null = null
  let oldRelatedRecordIds: RecordId[] = []
  let newRelatedRecordIds: RecordId[] = []

  if (fieldType === 'RELATIONSHIP') {
    const { entityDefinitionId } = parseRecordId(recordId)
    const metadata = getFieldMetadata?.(fieldId)
    const rel = metadata?.relationship

    // Derive values from RelationshipConfig using helpers
    const inverseFieldIdValue = rel ? getInverseFieldId(rel) : null
    const relatedEntityDefinitionId = rel ? getRelatedEntityDefinitionId(rel) : null

    if (inverseFieldIdValue && rel?.relationshipType && relatedEntityDefinitionId) {
      oldRelatedRecordIds = extractRelatedRecordIds(oldValue)
      newRelatedRecordIds = extractRelatedRecordIds(typedValue)

      // Build ResourceFieldIds for type-safe field identification
      const sourceResourceFieldId = toResourceFieldId(entityDefinitionId, fieldId)
      const inverseResourceFieldId = toResourceFieldId(
        relatedEntityDefinitionId,
        inverseFieldIdValue as FieldId
      )

      inverseInfo = {
        inverseResourceFieldId,
        sourceResourceFieldId,
        inverseRelationshipType: getInverseCardinality(rel.relationshipType),
        targetEntityDefinitionId: relatedEntityDefinitionId,
      }
    }
  }

  return {
    key,
    mutationVersion,
    typedValue,
    inverseInfo,
    oldRelatedRecordIds,
    newRelatedRecordIds,
  }
}

/** Handle mutation success - apply server result to store */
function handleMutationSuccess(
  key: FieldValueKey,
  mutationVersion: number,
  result: { state?: string; values?: Array<{ id?: string }>; jobId?: string } | undefined,
  fieldType: FieldType,
  fieldOptions?: FieldOptions
): boolean {
  const store = useFieldValueStore.getState()
  const currentVersion = store.getMutationVersion(key)

  if (mutationVersion < currentVersion) return false // Stale

  // AI stage-1 response: the value was optimistically cleared; confirm both
  // the value-pending flag and the 'generating' marker. The realtime socket
  // will bring the final value + result marker when the worker commits
  // stage 2, and that setValues call needs the pending flag cleared to not
  // be skipped.
  if (result?.state === 'generating') {
    store.confirmOptimistic(key)
    store.confirmAiStateOptimistic(key)
    return true
  }

  if (result?.values && result.values.length > 0) {
    // Static multi-value types (MULTI_SELECT, TAGS, etc.) always return arrays.
    // `fieldOptions` covers the conditional cases: options.multi scalars and
    // multi ACTOR fields — without it a one-value multi field would be stored
    // scalar-shaped. (`length > 1` stays as a fallback for callers that don't
    // thread options.)
    const returnsArray = isArrayReturnFieldType(fieldType, fieldOptions) || result.values.length > 1
    const valueToStore = returnsArray ? result.values : result.values[0]

    store.setValue(key, valueToStore)
    store.confirmOptimistic(key)
  } else if (fieldType && isArrayReturnFieldType(fieldType, fieldOptions)) {
    // Clearing an array-return field must leave `[]` in the store, not a
    // stale scalar shape — options.multi fields depend on `fieldOptions` here.
    store.setValue(key, [])
    store.confirmOptimistic(key)
  } else {
    store.confirmOptimistic(key)
  }

  return true
}

/** Handle mutation error with rollback */
function handleMutationError(
  key: FieldValueKey,
  mutationVersion: number,
  prep: {
    inverseInfo: InverseSyncInfo | null
    oldRelatedRecordIds: RecordId[]
    newRelatedRecordIds: RecordId[]
  },
  sourceRecordId: RecordId,
  syncInverseCache: (input: {
    sourceRecordId: RecordId
    oldRelatedRecordIds: RecordId[]
    newRelatedRecordIds: RecordId[]
    inverseInfo: InverseSyncInfo
  }) => void,
  error: Error | unknown,
  ai?: boolean
): void {
  const store = useFieldValueStore.getState()
  const currentVersion = store.getMutationVersion(key)

  if (mutationVersion < currentVersion) return // Superseded

  if (ai) {
    // Roll back only the AI marker. Intentionally do NOT rollback the
    // optimistic value clear — a failed generation leaves the cell empty
    // with an error badge, and users re-trigger to retry.
    store.rollbackAiState(key)
    store.confirmOptimistic(key)
  } else {
    store.rollbackOptimistic(key)
  }

  // Rollback inverse cache (swap old/new to reverse)
  if (prep.inverseInfo) {
    syncInverseCache({
      sourceRecordId,
      oldRelatedRecordIds: prep.newRelatedRecordIds, // Swap!
      newRelatedRecordIds: prep.oldRelatedRecordIds, // Swap!
      inverseInfo: prep.inverseInfo,
    })
  }

  const errorMessage = error instanceof Error ? error.message : 'Could not save this field value'
  toastError({
    title: 'Error saving field',
    description: errorMessage,
  })
}

// ─── NAME composites ─────────────────────────────────────────────────────────

/** One field write, in the shape every funnel function accepts it. */
interface FieldWrite {
  fieldId: string
  value: unknown
  fieldType?: FieldType
}

/**
 * Read the part-field ids off a registry field, through the SHARED linkage
 * predicate the server decomposes with (`readNameParts`).
 *
 * One predicate, one answer: an unlinked composite — not a NAME field, a
 * missing part id, or both parts pointing at the SAME field — has no parts to
 * write through, and client and server must agree on that or the client splits
 * a write the server would have stored raw. The adapter is only the shape:
 * a registry field carries `FieldType` on `fieldType` (`type` is the workflow
 * BaseType), while the shared predicate is structural over `{ type, options }`.
 */
function readFieldNameParts(field: ResourceField | undefined): NameParts | null {
  if (!field) return null
  return readNameParts({ type: field.fieldType, options: field.options })
}

/**
 * Resolve a bare fieldId to its field definition through the resource store.
 *
 * The funnel receives whatever spelling the caller had — a canonical field id,
 * a static key, or a systemAttribute (`full_name`) — so resolution goes through
 * `getFieldByRef`, which applies the store's alias resolution. Deliberately NOT
 * read off a caller-supplied `field` prop: several of those are typed `any`
 * (`PropertyProvider`'s among them), and a reshaped or sparser object fails a
 * NAME guard silently.
 */
function resolveStoreField(recordId: RecordId, fieldId: string): ResourceField | undefined {
  const { entityDefinitionId } = parseRecordId(recordId)
  return useResourceStore
    .getState()
    .getFieldByRef(toResourceFieldId(entityDefinitionId, fieldId as FieldId))
}

/**
 * The NAME parts every one of `recordIds` agrees on for `fieldId`, or null.
 *
 * One payload serves every record in a bulk set, and a bulk set may span entity
 * definitions where the same spelling resolves to a different field. A split is
 * therefore only safe when every record resolves the SAME composite; any
 * disagreement leaves the write untouched for the server to decompose.
 */
function resolveNameParts(recordIds: RecordId[], fieldId: string): NameParts | null {
  let parts: NameParts | null = null
  for (const recordId of recordIds) {
    const next = readFieldNameParts(resolveStoreField(recordId, fieldId))
    if (!next) return null
    if (
      parts &&
      (parts.firstNameFieldId !== next.firstNameFieldId ||
        parts.lastNameFieldId !== next.lastNameFieldId)
    ) {
      return null
    }
    parts = next
  }
  return parts
}

/**
 * Coerce any accepted NAME input into its two part strings.
 *
 * `coerceNameInput` is the shared coercion the server decomposes with, so every
 * shape a NAME write has ever accepted keeps working identically on both sides:
 * an object, an already-typed `json` value, and a bare full-name string
 * (`'Anita Bicknell'`, what a grid paste delivers). Its `null` — blank input,
 * i.e. a clear — is widened here to two empty strings, because the funnel's
 * callers want a write against each part rather than an absent entry.
 */
function coerceNameValue(value: unknown): { firstName: string; lastName: string } {
  return coerceNameInput(value) ?? { firstName: '', lastName: '' }
}

/**
 * Optimistically mirror the server-side `displayName` recompute into the record
 * store, so surfaces reading `record.displayName` (the drawer header) update
 * instantly. The editing tab is excluded from the `record:updated` realtime
 * echo, so without this it stays stale until a refetch. Only when this NAME
 * field actually drives the entity's primary displayName — mirrors the backend
 * gate.
 */
function mirrorNameDisplayName(
  recordId: RecordId,
  field: ResourceField,
  name: { firstName: string; lastName: string }
): void {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const resource = useResourceStore.getState().getResourceById(entityDefinitionId)
  if (resource?.display.primaryDisplayField?.id !== field.id) return
  useRecordStore.getState().updateRecord(entityDefinitionId, entityInstanceId, {
    displayName: `${name.firstName} ${name.lastName}`.trim(),
  })
}

/**
 * Rewrite NAME composite writes into writes against their two TEXT part fields.
 *
 * A NAME field is a COMPOSITE over `options.name.firstNameFieldId` /
 * `.lastNameFieldId` and stores nothing of its own — the value the UI shows is
 * derived from the parts, so a write that lands on the NAME field itself leaves
 * the parts stale and is undone by the next refetch.
 *
 * The split lives HERE, below every commit path, rather than in the editors:
 * `PropertyProvider` used to carry a copy in `commitValue` only, so committing
 * a name with Enter (`commitValueAndClose`) wrote the composite raw for as long
 * as the linking existed, and grid paste never split at all. Below the funnel
 * that divergence is not expressible.
 *
 * Both parts must travel in ONE request. Two separate single-field writes race
 * on the server-side `displayName` recompute: each part write recomposes by
 * reading its SIBLING from the DB, so concurrent first/last writes can read a
 * stale sibling and persist an outdated `displayName`. Callers holding a single
 * NAME write therefore hand it to the batched door.
 *
 * Idempotent: a list that resolves no NAME field is returned unchanged, so an
 * already-split write passes straight through.
 */
function expandNameWrites(recordIds: RecordId[], writes: FieldWrite[]): FieldWrite[] {
  let expanded: FieldWrite[] | null = null

  for (let index = 0; index < writes.length; index++) {
    const write = writes[index]
    if (!write) continue
    const parts = resolveNameParts(recordIds, write.fieldId)
    if (!parts) {
      expanded?.push(write)
      continue
    }
    if (!expanded) expanded = writes.slice(0, index)

    const name = coerceNameValue(write.value)
    expanded.push(
      { fieldId: parts.firstNameFieldId, value: name.firstName, fieldType: FieldTypeEnum.TEXT },
      { fieldId: parts.lastNameFieldId, value: name.lastName, fieldType: FieldTypeEnum.TEXT }
    )
    for (const recordId of recordIds) {
      const field = resolveStoreField(recordId, write.fieldId)
      if (field) mirrorNameDisplayName(recordId, field, name)
    }
  }

  return expanded ?? writes
}

/**
 * Hook for saving field values with optimistic updates to the shared store.
 * Updates store immediately, then syncs to DB in background.
 * Automatically rolls back on error.
 */
export function useSaveFieldValue(options: UseSaveFieldValueOptions = {}) {
  const { onSuccess, getFieldMetadata } = options

  // Relationship sync hook
  const { syncInverseCache } = useRelationshipSync()

  // Mutations
  const mutation = api.fieldValue.set.useMutation()
  const bulkMutation = api.fieldValue.setBulk.useMutation()

  // react-query's useMutation returns a NEW wrapper object on every render (it
  // has no useMemo around `{ ...result, mutate, mutateAsync }`), but the bound
  // .mutate / .mutateAsync fns are stable for the observer's lifetime. Depend on
  // those stable fns in the callbacks below — never the wrapper object — so the
  // callbacks keep a stable identity across unrelated re-renders. Otherwise any
  // memo/context derived from them (e.g. the records table's cellSelectionConfig,
  // which every cell consumes via context) is rebuilt every render and re-renders
  // the entire table on each selection toggle.
  const { mutate: setMutate, mutateAsync: setMutateAsync } = mutation
  const { mutate: bulkMutate, mutateAsync: bulkMutateAsync } = bulkMutation

  /**
   * Save multiple field values to a single resource (async version).
   * @param recordId - Full RecordId
   * @param fieldValues - Array of { fieldId, value, fieldType }
   */
  const saveMultipleAsync = useCallback(
    async (
      recordId: RecordId,
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>,
      saveOpts?: SaveOptions
    ): Promise<boolean> => {
      const normalizedRecordId = getNormalizedRecordId(recordId)
      const store = useFieldValueStore.getState()
      const ai = saveOpts?.ai === true
      const requestedAt = ai ? new Date().toISOString() : undefined

      // NAME composites are written through their two TEXT part fields — the
      // optimistic keys and the payload below are the part fields', never the
      // composite's. See {@link expandNameWrites}.
      const writes = expandNameWrites([normalizedRecordId], fieldValues)

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []
      for (const { fieldId, value, fieldType } of writes) {
        const key = buildFieldValueKey(
          normalizedRecordId,
          resolveFieldRef(fieldId, normalizedRecordId)
        )
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        if (ai) {
          store.setAiStateOptimistic(key, 'generating', { requestedAt })
          store.setValueOptimistic(key, null)
        } else {
          const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
          store.setValueOptimistic(key, typedValue)
        }
      }

      // Build API payload (keep original fieldIds — server resolves systemAttributes)
      const apiValues = writes.map(({ fieldId, value }) => ({ fieldId, value }))

      try {
        await bulkMutateAsync({
          recordIds: [normalizedRecordId],
          values: apiValues,
          ...(ai ? { ai: true } : {}),
        })

        const currentStore = useFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          if (version >= currentStore.getMutationVersion(key)) {
            if (ai) {
              currentStore.confirmOptimistic(key)
              currentStore.confirmAiStateOptimistic(key)
            } else {
              currentStore.confirmOptimistic(key)
            }
          }
        }
        onSuccess?.()
        return true
      } catch (error: unknown) {
        const currentStore = useFieldValueStore.getState()
        for (const { key, version } of keyVersions) {
          if (version >= currentStore.getMutationVersion(key)) {
            if (ai) {
              // Keep the optimistic null value — see handleMutationError.
              currentStore.rollbackAiState(key)
              currentStore.confirmOptimistic(key)
            } else {
              currentStore.rollbackOptimistic(key)
            }
          }
        }
        const errorMessage = error instanceof Error ? error.message : 'Could not save field values'
        toastError({ title: 'Error saving fields', description: errorMessage })
        return false
      }
    },
    [bulkMutateAsync, onSuccess]
  )

  /**
   * Save multiple field values to multiple resources in one API call.
   * @param recordIds - Array of RecordIds to update
   * @param fieldValues - Array of { fieldId, value, fieldType }
   */
  const saveBulkMultipleFields = useCallback(
    (
      recordIds: RecordId[],
      fieldValues: Array<{ fieldId: string; value: unknown; fieldType?: FieldType }>,
      saveOpts?: SaveOptions
    ): void => {
      const normalizedRecordIds = recordIds.map(getNormalizedRecordId)
      const store = useFieldValueStore.getState()
      const ai = saveOpts?.ai === true
      const requestedAt = ai ? new Date().toISOString() : undefined

      // NAME composites are written through their two TEXT part fields — the
      // optimistic keys and the payload below are the part fields', never the
      // composite's. See {@link expandNameWrites}.
      const writes = expandNameWrites(normalizedRecordIds, fieldValues)

      // Build all keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []

      for (const recordId of normalizedRecordIds) {
        for (const { fieldId, value, fieldType } of writes) {
          const key = buildFieldValueKey(recordId, resolveFieldRef(fieldId, recordId))
          const version = store.incrementMutationVersion(key)
          keyVersions.push({ key, version })
          if (ai) {
            store.setAiStateOptimistic(key, 'generating', { requestedAt })
            store.setValueOptimistic(key, null)
          } else {
            const typedValue = fieldType ? formatToTypedInput(value, fieldType) : value
            store.setValueOptimistic(key, typedValue)
          }
        }
      }

      // Build API payload (keep original fieldIds — server resolves systemAttributes)
      const apiValues = writes.map(({ fieldId, value }) => ({ fieldId, value }))

      bulkMutate(
        {
          recordIds: normalizedRecordIds,
          values: apiValues,
          ...(ai ? { ai: true } : {}),
        },
        {
          onSuccess: () => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                if (ai) {
                  currentStore.confirmOptimistic(key)
                  currentStore.confirmAiStateOptimistic(key)
                } else {
                  currentStore.confirmOptimistic(key)
                }
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                if (ai) {
                  // Keep the optimistic null value — see handleMutationError.
                  currentStore.rollbackAiState(key)
                  currentStore.confirmOptimistic(key)
                } else {
                  currentStore.rollbackOptimistic(key)
                }
              }
            }
            toastError({
              title: 'Error saving fields',
              description: error.message || 'Could not save field values',
            })
          },
        }
      )
    },
    [bulkMutate, onSuccess]
  )
  /**
   * Save a field value with optimistic update.
   * @param recordId - Full RecordId (entityDefinitionId:entityInstanceId)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   * @param fieldType - The field type for proper value extraction
   */
  const saveFieldValue = useCallback(
    (
      recordId: RecordId,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType,
      saveOpts?: SaveOptions
    ): void => {
      const normalizedRecordId = getNormalizedRecordId(recordId)

      // A NAME composite fans out into two part-field writes that must travel
      // in ONE request — hand it to the batched door, which splits it.
      if (resolveNameParts([normalizedRecordId], fieldId)) {
        saveBulkMultipleFields([normalizedRecordId], [{ fieldId, value, fieldType }], saveOpts)
        return
      }

      const ai = saveOpts?.ai === true
      const prep = prepareOptimisticUpdate(
        normalizedRecordId,
        fieldId as FieldId,
        value,
        fieldType,
        getFieldMetadata,
        ai,
        saveOpts?.fieldOptions
      )

      // Sync relationship cache (never for AI requests — stage-1 doesn't
      // change relationship graph; stage-2 lands through realtime later.)
      if (prep.inverseInfo && !ai) {
        syncInverseCache({
          sourceRecordId: normalizedRecordId,
          oldRelatedRecordIds: prep.oldRelatedRecordIds,
          newRelatedRecordIds: prep.newRelatedRecordIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      // Fire mutation
      setMutate(
        { recordId: normalizedRecordId, fieldId, value, ...(ai ? { ai: true } : {}) },
        {
          onSuccess: (result) => {
            if (
              handleMutationSuccess(
                prep.key,
                prep.mutationVersion,
                result,
                fieldType,
                saveOpts?.fieldOptions
              )
            ) {
              onSuccess?.()
            }
          },
          onError: (error) => {
            handleMutationError(
              prep.key,
              prep.mutationVersion,
              prep,
              normalizedRecordId,
              syncInverseCache,
              error,
              ai
            )
          },
        }
      )
    },
    [setMutate, onSuccess, getFieldMetadata, syncInverseCache, saveBulkMultipleFields]
  )

  /**
   * Async version that waits for mutation to complete.
   * @param recordId - Full RecordId (entityDefinitionId:entityInstanceId)
   * @param fieldId - The custom field ID
   * @param value - The value to save
   * @param fieldType - The field type for proper value extraction
   * @returns Object with success flag and optional id (first value's ID if available)
   */
  const saveFieldValueAsync = useCallback(
    async (
      recordId: RecordId,
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType,
      saveOpts?: SaveOptions
    ): Promise<{ success: boolean; id?: string } | undefined> => {
      const normalizedRecordId = getNormalizedRecordId(recordId)

      // A NAME composite fans out into two part-field writes that must travel
      // in ONE request — hand it to the batched door, which splits it.
      if (resolveNameParts([normalizedRecordId], fieldId)) {
        const success = await saveMultipleAsync(
          normalizedRecordId,
          [{ fieldId, value, fieldType }],
          saveOpts
        )
        return { success }
      }

      const ai = saveOpts?.ai === true
      const prep = prepareOptimisticUpdate(
        normalizedRecordId,
        fieldId as FieldId,
        value,
        fieldType,
        getFieldMetadata,
        ai,
        saveOpts?.fieldOptions
      )

      // Sync relationship cache
      if (prep.inverseInfo && !ai) {
        syncInverseCache({
          sourceRecordId: normalizedRecordId,
          oldRelatedRecordIds: prep.oldRelatedRecordIds,
          newRelatedRecordIds: prep.newRelatedRecordIds,
          inverseInfo: prep.inverseInfo,
        })
      }

      try {
        const result = await setMutateAsync({
          recordId: normalizedRecordId,
          fieldId,
          value,
          ...(ai ? { ai: true } : {}),
        })

        // Check if stale (a newer mutation was fired)
        const store = useFieldValueStore.getState()
        if (prep.mutationVersion < store.getMutationVersion(prep.key)) {
          return { success: true }
        }

        // Apply server result
        const firstValueId = result?.values?.[0]?.id
        handleMutationSuccess(
          prep.key,
          prep.mutationVersion,
          result,
          fieldType,
          saveOpts?.fieldOptions
        )
        onSuccess?.()
        return { success: true, id: firstValueId }
      } catch (error: unknown) {
        // Check if superseded — a newer mutation owns the store state now.
        const store = useFieldValueStore.getState()
        if (prep.mutationVersion < store.getMutationVersion(prep.key)) {
          return undefined
        }

        // Roll back the optimistic value and surface the server error
        // (e.g. a uniqueness conflict on a multi-value EMAIL field) —
        // without this the UI silently keeps a value the server rejected.
        handleMutationError(
          prep.key,
          prep.mutationVersion,
          prep,
          normalizedRecordId,
          syncInverseCache,
          error,
          ai
        )
        return { success: false }
      }
    },
    [setMutateAsync, onSuccess, getFieldMetadata, syncInverseCache, saveMultipleAsync]
  )

  /**
   * Save the same field value for multiple resources in a single API call.
   * @param recordIds - Array of RecordIds to update
   * @param fieldId - The field ID to update
   * @param value - The value to set for all resources
   * @param fieldType - The field type
   */
  const saveBulkValues = useCallback(
    (
      recordIds: RecordId[],
      fieldId: string,
      value: StoredFieldValue | unknown,
      fieldType: FieldType,
      saveOpts?: SaveOptions
    ): void => {
      const normalizedRecordIds = recordIds.map(getNormalizedRecordId)

      // A NAME composite fans out into two part-field writes that must travel
      // in ONE request — hand it to the batched door, which splits it.
      if (resolveNameParts(normalizedRecordIds, fieldId)) {
        saveBulkMultipleFields(normalizedRecordIds, [{ fieldId, value, fieldType }], saveOpts)
        return
      }

      const store = useFieldValueStore.getState()
      const ai = saveOpts?.ai === true

      // Build keys, capture versions, and apply optimistic updates
      const keyVersions: Array<{ key: FieldValueKey; version: number }> = []
      const typedValue = ai || !fieldType ? value : formatToTypedInput(value, fieldType)

      const requestedAt = ai ? new Date().toISOString() : undefined
      for (const recordId of normalizedRecordIds) {
        // Resolved per record, not hoisted: a bulk set may span definitions, and
        // a systemAttribute resolves to a different field on each of them.
        const key = buildFieldValueKey(recordId, resolveFieldRef(fieldId, recordId))
        const version = store.incrementMutationVersion(key)
        keyVersions.push({ key, version })
        if (ai) {
          store.setAiStateOptimistic(key, 'generating', { requestedAt })
          store.setValueOptimistic(key, null)
        } else {
          store.setValueOptimistic(key, typedValue)
        }
      }

      // Fire mutation (keep original fieldId — server resolves systemAttributes)
      bulkMutate(
        {
          recordIds: normalizedRecordIds,
          values: [{ fieldId, value }],
          ...(ai ? { ai: true } : {}),
        },
        {
          onSuccess: () => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                if (ai) {
                  currentStore.confirmOptimistic(key)
                  currentStore.confirmAiStateOptimistic(key)
                } else {
                  currentStore.confirmOptimistic(key)
                }
              }
            }
            onSuccess?.()
          },
          onError: (error) => {
            const currentStore = useFieldValueStore.getState()
            for (const { key, version } of keyVersions) {
              if (version >= currentStore.getMutationVersion(key)) {
                if (ai) {
                  // Keep the optimistic null value — see handleMutationError.
                  currentStore.rollbackAiState(key)
                  currentStore.confirmOptimistic(key)
                } else {
                  currentStore.rollbackOptimistic(key)
                }
              }
            }
            toastError({
              title: 'Error saving fields',
              description: error.message || 'Could not save field values',
            })
          },
        }
      )
    },
    [bulkMutate, onSuccess, saveBulkMultipleFields]
  )

  return {
    /** Save single field (for single-resource contexts like drawers) */
    saveFieldValue,
    /** Save single field, async - use for FILE fields that need value ID */
    saveFieldValueAsync,
    /** Save multiple fields to single resource, async */
    saveMultipleAsync,
    /** Save same value to multiple resources in one API call (for bulk operations) */
    saveBulkValues,
    /** Save multiple fields to multiple resources in one API call (for bulk dialogs) */
    saveBulkMultipleFields,
    isPending: mutation.isPending || bulkMutation.isPending,
  }
}
