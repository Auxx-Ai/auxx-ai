// ~/components/resources/hooks/use-resource-sync.ts

'use client'

import type {
  FieldValuesUpdatedEvent,
  RecordArchivedEvent,
  RecordCreatedEvent,
  RecordDeletedEvent,
  RecordsInvalidatedEvent,
  RecordUpdatedEvent,
} from '@auxx/lib/realtime'
import { getInstanceId, isRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import type { FieldReference, FieldValueKey } from '@auxx/types/field'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { patchParticipantsForContact } from '~/components/threads/store/participant-store'
import { useOrgChannel, useRecordChannels } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { fieldValueFetchQueue } from '../store/field-value-fetch-queue'
import { parseFieldValueKey, useFieldValueStore } from '../store/field-value-store'
import { getRecordStoreState, useRecordStore } from '../store/record-store'
import { useResourceStore } from '../store/resource-store'

/**
 * Coalesce window for the per-def subscribe callbacks. Every def channel binds
 * within a few ms of the catalog landing, so one timer turns that burst into a
 * single catch-up pass.
 */
const CATCH_UP_COALESCE_MS = 250

/**
 * Records reconciled per def. Matches `record.getByIds`' input cap, and keeps
 * the catch-up to one request per def no matter how far a list was scrolled.
 */
const CATCH_UP_RECORD_CAP = 100

/**
 * Ids the client is holding for a def, list order first (that is what is on
 * screen), then anything else in the record cache. Capped.
 */
function cachedRecordIdsForDef(entityDefinitionId: string, cap: number): string[] {
  const { lists, records } = getRecordStoreState()
  const prefix = `${entityDefinitionId}:`
  const ids: string[] = []
  const seen = new Set<string>()

  for (const [key, cache] of Object.entries(lists)) {
    if (!key.startsWith(prefix)) continue
    for (const id of cache.ids) {
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
      if (ids.length >= cap) return ids
    }
  }

  for (const id of records[entityDefinitionId]?.keys() ?? []) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= cap) return ids
  }

  return ids
}

/**
 * Did this client materialize anything for the def BEFORE its channel bound?
 *
 * This is the whole reason the catch-up does not storm. A def with no rows and
 * no lists in the store has nothing that could have gone stale — whatever is
 * fetched after the channel binds is fresh by definition — so the 20–40 defs a
 * page load subscribes to cost zero requests. Only defs whose data was already
 * on the client (the route being rendered, and anything still on screen across
 * a reconnect) are reconciled.
 */
function hasMaterializedState(entityDefinitionId: string): boolean {
  const { lists, records } = getRecordStoreState()
  if ((records[entityDefinitionId]?.size ?? 0) > 0) return true
  const prefix = `${entityDefinitionId}:`
  return Object.keys(lists).some((key) => key.startsWith(prefix))
}

/** Every (record, field) pair the value store already holds for these records. */
function cachedValueRequests(
  entityDefinitionId: string,
  recordIds: Set<string>
): Array<{ recordId: RecordId; fieldRef: FieldReference }> {
  const prefix = `${entityDefinitionId}:`
  const requests: Array<{ recordId: RecordId; fieldRef: FieldReference }> = []
  for (const key of Object.keys(useFieldValueStore.getState().values)) {
    if (!key.startsWith(prefix)) continue
    const { recordId, fieldRef, entityInstanceId } = parseFieldValueKey(key as FieldValueKey)
    if (!recordIds.has(entityInstanceId)) continue
    requests.push({ recordId, fieldRef })
  }
  return requests
}

/**
 * Record lane → participant store bridge (contact-name precedence): a contact
 * rename/avatar change must flip mail labels live, and this lane already
 * carries exactly that event. Instance ids are globally unique, so no def
 * check is needed — the store scan simply matches nothing for non-contacts.
 * Only keys present on the payload are forwarded (`undefined` = don't touch);
 * per-participant "usable name" normalization happens inside the store patch.
 */
function patchParticipantsForRecordMeta(record: {
  id: string
  displayName?: string
  avatarUrl?: string | null
}) {
  if (record.displayName === undefined && record.avatarUrl === undefined) return
  patchParticipantsForContact(record.id, {
    contactName: record.displayName,
    avatarUrl: record.avatarUrl,
  })
}

/**
 * Deleted/archived contacts fall back to the header/identifier label —
 * mirrors the FK `ON DELETE set null` / archived-contact semantics of the
 * fetch path. `recordId` on these events is the composite form.
 */
function clearParticipantsForRecord(recordId: RecordId | string) {
  const instanceId = isRecordId(recordId) ? getInstanceId(recordId) : recordId
  if (!instanceId) return
  patchParticipantsForContact(instanceId, { contactName: null, avatarUrl: null })
}

/**
 * Global hook that subscribes to real-time resource events and feeds data into
 * the existing Zustand stores. Mount once in the app layout.
 *
 * Two subscription lanes (plan v3/03 §8.1):
 * - **Per-def record channels** (`rooms.orgRecords`) carry the record family
 *   (`record:*`, `fieldValues:updated`, `records:invalidated`). Those payloads
 *   include raw stored field values, so each def's channel is ACL'd on
 *   `canViewEntity(defId)` server-side. We request a channel for every def in
 *   the hydrated catalog — the catalog is deliberately unfiltered (redacted
 *   relationship chips still need def metadata), and a def the member cannot
 *   view is denied at Pusher auth rather than filtered here.
 * - **The org channel** still carries def-catalog nudges (`resource:*`), which
 *   are invalidation-only and carry no record data.
 *
 * Plus a targeted catch-up when a record channel (re)binds — see
 * `handleDefSubscribed` below for why it costs nothing on a cold load.
 */
export function useResourceSync() {
  const utils = api.useUtils()

  // The def channels to subscribe to. `resources` is the full hydrated catalog
  // (system + custom); it is empty until `resource.list` lands, so nothing is
  // subscribed before then — same shape as mail waiting on `inbox.myLenses`.
  const resources = useResourceStore((s) => s.resources)
  const entityDefinitionIds = useMemo(() => resources.map((r) => r.entityDefinitionId), [resources])

  // Store actions (selectors to avoid re-renders)
  const setValues = useFieldValueStore((s) => s.setValues)
  const setAiState = useFieldValueStore((s) => s.setAiState)
  const invalidateResource = useFieldValueStore((s) => s.invalidateResource)
  const setRecords = useRecordStore((s) => s.setRecords)
  const updateRecord = useRecordStore((s) => s.updateRecord)
  const removeRecord = useRecordStore((s) => s.removeRecord)
  const invalidateLists = useRecordStore((s) => s.invalidateLists)

  // Merge fieldValues:updated into the store. An entry with `value` present
  // goes through `setValues` (which preserves the pending-optimistic skip).
  // An entry with `aiStatus` present writes the AI marker — `null` clears it.
  const handleFieldValuesUpdated = useCallback(
    (raw: unknown) => {
      const data = raw as FieldValuesUpdatedEvent['data']
      const valueEntries = data.entries.filter((e) => e.value !== undefined) as Array<{
        key: (typeof data.entries)[number]['key']
        value: unknown
      }>
      if (valueEntries.length > 0) setValues(valueEntries)

      for (const entry of data.entries) {
        if (entry.aiStatus !== undefined) {
          setAiState(entry.key, entry.aiStatus, entry.aiMetadata ?? null)
        }
      }
    },
    [setValues, setAiState]
  )

  const handleRecordCreated = useCallback(
    (raw: unknown) => {
      const data = raw as RecordCreatedEvent['data']
      // `setRecords` REPLACES the row wholesale and this payload carries no
      // `_access` stamp (it is member-relative; the publisher has no member).
      // A row we already hold is therefore left alone rather than downgraded to
      // an unknown rung — the create event only ever ADDS rows anyway.
      const known = getRecordStoreState().records[data.entityDefinitionId]?.get(data.record.id)
      setRecords(data.entityDefinitionId, [{ ...(data.record as any), _access: known?._access }])
      invalidateLists(data.entityDefinitionId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
      if (data.fieldValues?.length) {
        setValues(data.fieldValues)
      }
      patchParticipantsForRecordMeta(data.record)
    },
    [setRecords, invalidateLists, setValues, utils]
  )

  // Partial-update the cached record if we already have it. Merge only keys
  // present on the payload — `undefined` means "don't touch", `null` clears.
  const handleRecordUpdated = useCallback(
    (raw: unknown) => {
      const data = raw as RecordUpdatedEvent['data']
      const { displayName, secondaryDisplayValue, avatarUrl, updatedAt } = data.record
      const patch: Record<string, unknown> = {}
      if (displayName !== undefined) patch.displayName = displayName
      if (secondaryDisplayValue !== undefined) patch.secondaryDisplayValue = secondaryDisplayValue
      if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl
      if (updatedAt !== undefined) patch.updatedAt = updatedAt
      if (Object.keys(patch).length === 0) return
      updateRecord(data.entityDefinitionId, data.record.id, patch)
      patchParticipantsForRecordMeta(data.record)
    },
    [updateRecord]
  )

  const handleRecordDeleted = useCallback(
    (raw: unknown) => {
      const data = raw as RecordDeletedEvent['data']
      removeRecord(data.entityDefinitionId, data.recordId)
      invalidateLists(data.entityDefinitionId)
      invalidateResource(data.recordId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
      clearParticipantsForRecord(data.recordId)
    },
    [removeRecord, invalidateLists, invalidateResource, utils]
  )

  const handleRecordArchived = useCallback(
    (raw: unknown) => {
      const data = raw as RecordArchivedEvent['data']
      invalidateLists(data.entityDefinitionId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
      clearParticipantsForRecord(data.recordId)
    },
    [invalidateLists, utils]
  )

  // Coarse refresh from a bulk write (data-connector slice). Per-record realtime
  // is suppressed for those writes, so a single invalidate per def per slice
  // re-pulls the visible list (records + field values) without the firehose.
  // Same body as handleRecordArchived — invalidate lists + listFiltered.
  const handleRecordsInvalidated = useCallback(
    (raw: unknown) => {
      const data = raw as RecordsInvalidatedEvent['data']
      invalidateLists(data.entityDefinitionId)
      utils.record.listFiltered.invalidate({ entityDefinitionId: data.entityDefinitionId })
    },
    [invalidateLists, utils]
  )

  // A resource (entity DEFINITION) was created / renamed / removed elsewhere —
  // in another tab, or by background connector provisioning. Coarse refetch: mirror
  // the acting client's `invalidateResourceDefinitions()` so a remote client reaches
  // the same freshness (sidebar/provider AND the workflow-node/picker lists that read
  // `entityDefinition.getAll`). Payload is ignored — the resource list is small.
  const handleResourceDefChanged = useCallback(() => {
    utils.resource.list.invalidate()
    utils.entityDefinition.getAll.invalidate()
    utils.entityDefinition.getBySlug.invalidate()
    utils.entityDefinition.getById.invalidate()
  }, [utils])

  // Per-def record-channel dispatcher. Bound across every def channel; the
  // payloads are identical to what the org channel used to carry.
  const onRecordEvent = useCallback(
    (event: string, payload: unknown) => {
      switch (event) {
        case 'fieldValues:updated':
          return handleFieldValuesUpdated(payload)
        case 'record:created':
          return handleRecordCreated(payload)
        case 'record:updated':
          return handleRecordUpdated(payload)
        case 'record:deleted':
          return handleRecordDeleted(payload)
        case 'record:archived':
          return handleRecordArchived(payload)
        case 'records:invalidated':
          return handleRecordsInvalidated(payload)
      }
    },
    [
      handleFieldValuesUpdated,
      handleRecordCreated,
      handleRecordUpdated,
      handleRecordDeleted,
      handleRecordArchived,
      handleRecordsInvalidated,
    ]
  )

  // ─── CATCH-UP ON (RE)SUBSCRIBE ──────────────────────────────────────────
  //
  // Pusher replays nothing to a channel you were not on, and a record channel
  // cannot bind until `resource.list` resolves (its key needs the def id). So
  // anything published between mount and that handshake — and between a
  // dropped connection and its resubscribe — is simply never delivered.
  //
  // The catch-up is scoped by `hasMaterializedState`: only defs this client had
  // already loaded when the channel bound can hold stale data, which on a cold
  // page load is nothing at all (the list query needs the same catalog the
  // channel key does) and after that is just what is on screen. So it is one
  // def, not the 20–40 the client subscribes to.
  //
  // Both lanes below overwrite in place instead of dropping. Dropping is not
  // an option for values: the subscriber hooks dedupe per key for the lifetime
  // of the mount, so an invalidated cell would never be re-requested.
  const catchUpDefsRef = useRef<Set<string>>(new Set())
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runCatchUp = useCallback(
    (entityDefinitionIds: string[]) => {
      for (const entityDefinitionId of entityDefinitionIds) {
        // 1. Row membership — creates/deletes/archives/bulk invalidations. The
        //    tRPC data stays cached while it refetches, so rows do not blank.
        invalidateLists(entityDefinitionId)
        utils.record.listFiltered.invalidate({ entityDefinitionId })

        const ids = cachedRecordIdsForDef(entityDefinitionId, CATCH_UP_RECORD_CAP)
        if (ids.length === 0) continue

        // 2. Record meta — a missed `record:updated` (display name, avatar).
        //    `updateRecord` patches rows we already hold and ignores the rest.
        utils.record.getByIds
          .fetch({ items: ids.map((id) => toRecordId(entityDefinitionId, id)) }, { staleTime: 0 })
          .then((data) => {
            for (const item of Object.values(data ?? {})) {
              updateRecord(entityDefinitionId, item.id, {
                displayName: item.displayName,
                secondaryInfo: item.secondaryInfo,
                avatarUrl: item.avatarUrl,
                // A missed grant/revoke changes the row-effective rung, not the
                // row (plan v3/03 §5.2) — so the catch-up must carry `_access`
                // or a member whose share was revoked keeps the edit affordance
                // until the row is evicted.
                _access: item._access,
              })
            }
          })
          .catch(() => {
            /* best-effort; the next subscribe or refresh retries */
          })

        // 3. Cell values — a missed `fieldValues:updated`. Refreshes exactly
        //    the cells already in the store, in one batched request.
        const requests = cachedValueRequests(entityDefinitionId, new Set(ids))
        if (requests.length > 0) fieldValueFetchQueue.refetch(requests)
      }
    },
    [invalidateLists, updateRecord, utils]
  )

  // The decision of WHETHER a def needs catching up is made here, at subscribe
  // time — not when the coalesced pass runs. Otherwise a list that resolves
  // during the coalesce window (the normal cold-load ordering) would look like
  // pre-existing state and earn a pointless re-fetch of what just arrived.
  const handleDefSubscribed = useCallback(
    (entityDefinitionId: string) => {
      if (!hasMaterializedState(entityDefinitionId)) return
      catchUpDefsRef.current.add(entityDefinitionId)
      if (catchUpTimerRef.current) return
      catchUpTimerRef.current = setTimeout(() => {
        catchUpTimerRef.current = null
        const defIds = [...catchUpDefsRef.current]
        catchUpDefsRef.current.clear()
        runCatchUp(defIds)
      }, CATCH_UP_COALESCE_MS)
    },
    [runCatchUp]
  )

  useEffect(
    () => () => {
      if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current)
    },
    []
  )

  // Org-channel dispatcher — def-catalog changes only.
  const onOrgEvent = useCallback(
    (event: string) => {
      switch (event) {
        case 'resource:created':
        case 'resource:updated':
        case 'resource:deleted':
          return handleResourceDefChanged()
      }
    },
    [handleResourceDefChanged]
  )

  useRecordChannels(entityDefinitionIds, {
    onEvent: onRecordEvent,
    onDefSubscribed: handleDefSubscribed,
  })
  useOrgChannel({ onEvent: onOrgEvent })
}
