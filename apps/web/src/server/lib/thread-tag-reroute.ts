// apps/web/src/server/lib/thread-tag-reroute.ts

import type { Database } from '@auxx/database'
import { getCachedResources, getCachedUserInstanceGrants, getOrgCache } from '@auxx/lib/cache'
import type { SetValueResult } from '@auxx/lib/field-values'
import { FieldValueService } from '@auxx/lib/field-values'
import { buildDefIdToSlug } from '@auxx/lib/permissions'
import { ThreadMutationService } from '@auxx/lib/threads'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'

/**
 * Reroute a THREAD-TAG write arriving through the generic field-value door
 * onto `ThreadMutationService.tagThreadsBulk` — thread-events §13.7 finding 2.
 *
 * `tagThreadsBulk` is the single choke point that emits `thread:tagged` /
 * `thread:untagged` and publishes the MAIL-side realtime patch; the generic
 * `fieldValue.set` path (the mail UI's `use-thread-tags` hook and the record
 * drawer's Tags field) would stay silent on both. The reroute keeps the write
 * itself identical — the 'set' operation funnels into the same
 * `setValueWithBuiltIn` — and reads the resulting values back so the response
 * shape matches the generic path byte-for-byte.
 *
 * Returns `null` when this call is NOT a thread-tag replace (different host,
 * different field, add/remove mode, AI autofill, or an unrecognized value
 * encoding) — the caller then falls through to the generic path unchanged.
 *
 * Resolution is by SLUG, never the raw RecordId def part — the mail UI mints
 * thread RecordIds from the def's CUID (see `field-value-host-access.ts`).
 */
export async function rerouteThreadTagSet(params: {
  db: Database
  organizationId: string
  userId: string
  socketId?: string
  recordId: RecordId
  fieldId: string
  value: unknown
  mode: 'set' | 'add' | 'remove'
  ai?: boolean
}): Promise<SetValueResult | null> {
  const { db, organizationId, userId, socketId, recordId, fieldId, value, mode, ai } = params
  if (mode !== 'set' || ai) return null

  // Detection is best-effort: a cache hiccup degrades to the generic write
  // (still gated, still committed — only the tag event is missed) rather than
  // failing the save. Everything past detection stays loud.
  try {
    // Host must resolve to the thread def.
    const { entityDefinitionId } = parseRecordId(recordId)
    const resources = await getCachedResources(organizationId)
    const toSlug = buildDefIdToSlug(resources)
    if (toSlug(entityDefinitionId) !== 'thread') return null

    // Field must be the org's `thread_tags` system field.
    const tagsField = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttribute('thread_tags')
    if (!tagsField || tagsField.id !== fieldId) return null
  } catch {
    return null
  }

  // Normalize the tag list: the mail hook sends RecordId strings, the
  // relationship editors may send `{ recordId }` envelopes. Anything else
  // falls through to the generic path rather than being guessed at.
  const raw = value == null ? [] : Array.isArray(value) ? value : [value]
  const tagRecordIds: RecordId[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry) {
      tagRecordIds.push(entry as RecordId)
    } else if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { recordId?: unknown }).recordId === 'string'
    ) {
      tagRecordIds.push((entry as { recordId: string }).recordId as RecordId)
    } else {
      return null
    }
  }

  const viewer = await getCachedUserInstanceGrants(userId, organizationId)
  const service = new ThreadMutationService(
    organizationId,
    db,
    socketId,
    { kind: 'user', id: userId },
    viewer
  )
  await service.tagThreadsBulk([recordId], tagRecordIds, 'set')

  // Read the committed rows back so the response matches what the generic
  // `setValueWithBuiltIn` would have returned for the same write.
  const fieldValueService = new FieldValueService(organizationId, userId, db, socketId)
  const valuesByField = await fieldValueService.getValues({ recordId, fieldIds: [fieldId] })
  const stored = valuesByField.get(fieldId)
  const values = stored === undefined ? [] : Array.isArray(stored) ? stored : [stored]
  return { state: 'complete', performedAt: new Date().toISOString(), values }
}
