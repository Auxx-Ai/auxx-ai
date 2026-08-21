// apps/web/src/components/fields/inputs/hooks/use-field-uploading-files.ts

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import type { JsonFieldValue, TypedFieldValue } from '@auxx/types/field-value'
import { useMemo } from 'react'
import { isFileInFlight, useUploadStore } from '~/components/file-upload/stores'
import { useFieldValueStore } from '~/components/resources/store/field-value-store'
import { buildCanonicalFieldValueKey } from '~/components/resources/utils/canonicalize-field-ref'

/** One in-flight file, in the shape a badge needs. Names come from the local
 *  `File`, so they are known the instant the picker closes — no server roundtrip. */
export interface FieldUploadingFile {
  id: string
  name: string
  mimeType: string | null
  progress: number
  status: string
}

/**
 * In-flight uploads for one record+field, readable from ANY component.
 *
 * `useFieldFileUpload` already derives this, but it also registers pickers,
 * completion handlers and mutations — far too much for a read-only display that
 * only wants to render a badge. The uploaderId is the same deterministic key, so
 * both see the same session.
 *
 * Exists because the badge used to appear only once the value round-tripped AND
 * `file.resolveFileRefs` answered for it. Until then an upload in progress showed
 * nothing at all, so picking a file looked like it had done nothing.
 *
 * A `completed` file stays badge-worthy until its `asset:` ref shows up in the
 * field-value store — the store flips `status: 'completed'` the moment the bytes
 * land, but the completion handler still has to round-trip `fieldValue.set/add`
 * before the value the display renders from exists. Dropping the badge on the
 * status flip made every file blink out for that whole window (sequential adds
 * make it seconds on multi-file fields) and reappear. This is the read-only twin
 * of `useFieldFileUpload`'s `absorbedAssetIds` settling logic; the ref-store
 * details are seeded before the mutation, so once the ref lands the real item
 * renders in the same frame the badge unmounts.
 */
export function useFieldUploadingFiles(
  recordId: RecordId | string,
  fieldRef: string
): FieldUploadingFile[] {
  const uploaderId = `field-upload:${recordId}:${fieldRef}`

  // Same canonical key `useFieldValue` subscribes with. A display-only context
  // hands in an empty recordId — no record, no session, no saved values.
  const storeKey = useMemo(() => {
    if (!recordId || !fieldRef) return null
    try {
      return buildCanonicalFieldValueKey(recordId as RecordId, fieldRef as FieldReference).key
    } catch {
      return null
    }
  }, [recordId, fieldRef])

  // Refs already saved on the field — a completed upload whose ref is in here has
  // been absorbed and owns no badge any more. A cheap string fingerprint, same
  // reasoning as below.
  const savedRefs = useFieldValueStore((state) => {
    if (!storeKey) return ''
    const val = state.values[storeKey]
    if (!val) return ''
    const arr = Array.isArray(val) ? (val as TypedFieldValue[]) : [val as TypedFieldValue]
    return arr
      .map((tv) => (tv.type === 'json' ? ((tv as JsonFieldValue).value?.ref ?? '') : ''))
      .filter(Boolean)
      .join('|')
  })

  // Subscribe to a cheap string fingerprint, not to object identities — the store
  // rewrites file objects on every progress tick.
  const fingerprint = useUploadStore((state) => {
    const sessionId = state.uploaderSessions?.[uploaderId]
    if (!sessionId) return ''
    const session = state.sessions[sessionId]
    if (!session) return ''
    const savedRefSet = new Set(savedRefs.split('|'))
    const parts: string[] = []
    for (const id of session.fileIds) {
      const f = state.files[id]
      if (!f || !ownsBadge(f.status, f.serverFileId, savedRefSet)) continue
      parts.push(`${f.id}:${f.status}:${Math.round(f.progress ?? 0)}`)
    }
    return parts.join('|')
  })

  return useMemo(() => {
    if (!fingerprint) return EMPTY
    const state = useUploadStore.getState()
    const sessionId = state.uploaderSessions?.[uploaderId]
    if (!sessionId) return EMPTY
    const session = state.sessions[sessionId]
    if (!session) return EMPTY
    const savedRefSet = new Set(savedRefs.split('|'))

    return session.fileIds
      .map((id) => state.files[id])
      .filter(
        (f): f is NonNullable<typeof f> =>
          f !== undefined && ownsBadge(f.status, f.serverFileId, savedRefSet)
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType ?? null,
        progress: f.status === 'completed' ? 100 : (f.progress ?? 0),
        status: f.status,
      }))
  }, [fingerprint, savedRefs, uploaderId])
}

/** Failed/cancelled files vanish; completed ones hold their badge until absorbed. */
function ownsBadge(
  status: Parameters<typeof isFileInFlight>[0],
  serverFileId: string | undefined,
  savedRefSet: Set<string>
): boolean {
  if (status === 'completed') {
    return !!serverFileId && !savedRefSet.has(`asset:${serverFileId}`)
  }
  return isFileInFlight(status)
}

const EMPTY: FieldUploadingFile[] = []
