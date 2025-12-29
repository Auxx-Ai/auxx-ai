// apps/web/src/components/mail/email-editor/use-draft-autosave.ts
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
import type { DraftPayload, DraftMessage } from './types'
type FileAttachment = {
  id: string
  name: string
  size?: number
  mimeType?: string
  type: 'file' | 'asset' // 'file' = FolderFile, 'asset' = MediaAsset
}
// Remove local DraftPayload type definition since it's now imported from types
/**
 * Full key for post-first-save (includes all fields)
 */
function buildKey(p: DraftPayload) {
  return JSON.stringify({
    integrationId: p.integrationId,
    subject: p.subject,
    textHtml: p.textHtml,
    signatureId: p.signatureId,
    to: p.to,
    cc: p.cc,
    bcc: p.bcc,
    attachments: p.attachments,
    metadata: p.metadata,
  })
}
/**
 * Content-only key for first save (so subject/recipients changes don't schedule saves yet)
 */
function buildFirstKey(p: DraftPayload) {
  return JSON.stringify({ textHtml: p.textHtml })
}
export function useDraftAutosave({
  enabled,
  payload,
  isEmpty,
  createOrUpdateDraft,
  onSaved,
  onCacheSync,
}: {
  enabled: boolean
  payload: DraftPayload
  isEmpty: () => boolean
  createOrUpdateDraft: (
    p: DraftPayload & {
      deleteIfEmpty?: boolean
    }
  ) => Promise<DraftMessage>
  onSaved: (ids: { draftId: string | null; threadId: string | null }) => void
  onCacheSync?: (args: {
    draftId: string | null
    threadId: string | null
    payload: DraftPayload
    draftData?: DraftMessage
    firstSave: boolean
  }) => void
}) {
  const version = useRef(0)
  const isSaving = useRef(false)
  const isDeleting = useRef(false)
  const lastSavedKey = useRef<string | null>(null)
  const firstSave = !payload.draftId
  const key = useMemo(
    () => (firstSave ? buildFirstKey(payload) : buildKey(payload)),
    [firstSave, payload]
  )
  const debouncedSave = useDebouncedCallback(
    async (p: DraftPayload, k: string, isFirst: boolean) => {
      // Check if aborted before starting
      if (!enabled || isSaving.current || isDeleting.current) return
      // For the very first save attempt, require non-empty body only
      if (isFirst && isEmpty()) return
      // Avoid re-saving identical content
      if (lastSavedKey.current === k) return
      const currentVersion = ++version.current
      isSaving.current = true
      try {
        // Check again after async boundary
        if (isDeleting.current) {
          isSaving.current = false
          return
        }
        const result = await createOrUpdateDraft({
          ...p,
          // Keep false so we don't auto-delete a reply draft that has subject+recipients but empty body
          deleteIfEmpty: false,
        })
        // Check if still relevant after save completes
        if (!isDeleting.current && currentVersion === version.current) {
          onSaved({ draftId: result.id, threadId: result.threadId })
          // Update lastSavedKey after successful save
          lastSavedKey.current = k
          // Optional cache sync callback for host components (e.g., TRPC cache)
          onCacheSync?.({
            draftId: result.id,
            threadId: result.threadId,
            payload: p,
            draftData: result,
            firstSave: isFirst,
          })
        }
      } catch (error: any) {
        // Check if it's a 404 - draft was deleted
        if (
          error?.data?.code === 'NOT_FOUND' ||
          error?.message?.includes('not found') ||
          error?.message?.includes("doesn't exist") ||
          error?.message?.includes('no longer exists')
        ) {
          // Draft was deleted - stop autosaving silently
          isDeleting.current = true
          lastSavedKey.current = null
          // Reset draft ID in parent component
          onSaved({ draftId: null, threadId: null })
          // No error toast - this is expected behavior
          return
        }
        // For save failures, preserve local state and don't overwrite cache
        // The cache should retain the optimistic local state until next successful save
        console.warn('Draft autosave failed:', error?.message || error)
        // For other errors, let the mutation handle error display
        throw error
      } finally {
        isSaving.current = false
      }
    },
    1200
  ) // 1.2 second debounce
  // Enhanced abort method to cancel autosave and prevent further saves
  const abort = useCallback(() => {
    isDeleting.current = true
    isSaving.current = false // Stop any saves
    debouncedSave.cancel()
    version.current++ // Invalidate any pending saves
  }, [debouncedSave])
  useEffect(() => {
    if (!enabled) return
    debouncedSave(payload, key, firstSave)
  }, [enabled, key, firstSave, payload, debouncedSave])
  return {
    isSaving: isSaving.current,
    version: version.current,
    abort,
  }
}
