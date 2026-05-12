// apps/web/src/components/editor/utils/client-session-id.ts
import { generateId } from '@auxx/utils'

let cached: string | null = null

/**
 * Stable per-tab id used to tag outgoing realtime-relevant mutations so the
 * originating tab can drop its own server-side echo (kb-article-resync).
 * Module scope — each tab gets a fresh id at boot, not shared via storage.
 */
export function getClientSessionId(): string {
  if (cached) return cached
  cached = generateId()
  return cached
}
