// apps/web/src/components/mail/email-editor/draft-reconciler.ts
import type { DraftMessage, DraftPayload, LocalAttachment, FileAttachment } from './types'

export interface ReconcileOptions {
  isFirstSave: boolean
}

export interface ExtendedDraftMessage extends DraftMessage {
  serverUpdatedAt?: number
  localVersion?: number
}

/**
 * Merge attachments, deduplicating by ID or client properties
 * @param server - Server attachments (persisted)
 * @param localPending - Local pending attachments (client-only)
 * @returns Merged attachment array
 */
function mergeAttachments(
  server: FileAttachment[],
  localPending: LocalAttachment[]
): (FileAttachment | LocalAttachment)[] {
  const byKey = new Map<string, FileAttachment | LocalAttachment>()
  
  // Add server attachments (they take precedence)
  for (const attachment of server) {
    byKey.set(`s:${attachment.id}`, attachment)
  }
  
  // Add local pending attachments that don't conflict
  for (const attachment of localPending) {
    const serverKey = `s:${attachment.id}`
    const clientKey = attachment.clientId ? `c:${attachment.clientId}` : `tmp:${Math.random()}`
    
    // Skip if server already has this attachment by ID
    if (byKey.has(serverKey)) {
      continue
    }
    
    // Use clientId or fallback key for local items
    if (!byKey.has(clientKey)) {
      byKey.set(clientKey, attachment)
    }
  }
  
  return Array.from(byKey.values())
}

/**
 * Reconcile local draft state with server response, preserving client-only fields
 * @param local - Current local draft message (may be undefined)
 * @param server - Server draft response (may be undefined for optimistic updates)
 * @param opts - Reconciliation options
 * @returns Reconciled draft message
 */
export function reconcileDraft(
  local: ExtendedDraftMessage | undefined,
  server?: DraftMessage,
  opts: ReconcileOptions = { isFirstSave: false }
): ExtendedDraftMessage {
  // If no server data, preserve local state but increment local version
  if (!server) {
    if (!local) {
      throw new Error('Cannot reconcile without local or server data')
    }
    return {
      ...local,
      localVersion: (local.localVersion ?? 0) + 1,
    }
  }
  
  // Server data available - reconcile fields
  const reconciled: ExtendedDraftMessage = {
    // Server-owned fields (always take from server when available)
    id: server.id,
    threadId: server.threadId,
    subject: server.subject,
    textHtml: server.textHtml,
    textPlain: server.textPlain,
    signatureId: server.signatureId,
    metadata: server.metadata,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    
    // Update server timestamp for freshness tracking
    serverUpdatedAt: server.updatedAt ? new Date(server.updatedAt).getTime() : Date.now(),
    localVersion: (local?.localVersion ?? 0) + 1,
  }
  
  // Handle participants (server-owned, but with special handling for first save)
  if (opts.isFirstSave && local?.participants && (!server.participants || server.participants.length === 0)) {
    // Before first save: preserve local participant roles if server hasn't normalized them yet
    reconciled.participants = local.participants
  } else {
    // After first save or when server has participants: always use server participants (normalized)
    reconciled.participants = server.participants || []
  }
  
  // Handle attachments - always prefer server attachments for cache display
  // Don't try to merge local pending attachments as this can cause save loops
  reconciled.attachments = (server as any).attachments || []
  
  return reconciled
}

/**
 * Check if server response is stale compared to local state
 * @param local - Local draft state
 * @param server - Server draft response
 * @returns true if server response is stale
 */
export function isServerResponseStale(
  local: ExtendedDraftMessage | undefined,
  server: DraftMessage
): boolean {
  if (!local?.serverUpdatedAt || !server.updatedAt) {
    return false // Can't determine staleness without timestamps
  }
  
  const serverTime = new Date(server.updatedAt).getTime()
  return serverTime < local.serverUpdatedAt
}