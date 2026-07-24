// packages/lib/src/ai/kopilot/capabilities/kb/kb-access.ts

import type { CapabilityView } from '../../../../permissions/capabilities/capability-view'

/**
 * Instance-access READ gate for KB tools (permissions v2 §3.3).
 *
 * Reads keep the **silent-filter** semantics humans get: a KB the principal
 * can't view is reported as "not found" / dropped from a list, never as a 403.
 * (Write gates are the opposite — they `assertEditInstance` and throw, so the
 * model can explain the denial.)
 *
 * `capabilities === undefined` ⇒ unrestricted (the workflow AI node is the one
 * remaining un-threaded caller), so behavior is byte-for-byte unchanged there.
 *
 * @param capabilities Resolved capability view for the turn, if any.
 * @param knowledgeBaseId The KB instance the caller is trying to read.
 */
export function canViewKb(
  capabilities: CapabilityView | undefined,
  knowledgeBaseId: string | null | undefined
): boolean {
  if (!capabilities) return true
  if (!knowledgeBaseId) return true
  return capabilities.canViewInstance('kb', knowledgeBaseId)
}
