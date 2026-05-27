// packages/chat/src/views/kb/kb-tree-store.ts
//
// In-memory cache for the KB tree. The tree is fetched on the first KB
// navigation and reused across every kb-section frame for the rest of the
// widget session. Cross-frame navigation between sections is a memory walk,
// not a network call.

import { type KbTreeResponse, kbApi } from '~/transport/kb-api'

const cache = new Map<string, Promise<KbTreeResponse>>()

export function loadKbTree(channelId: string): Promise<KbTreeResponse> {
  const existing = cache.get(channelId)
  if (existing) return existing
  const fetched = kbApi(channelId)
    .getTree()
    .catch((err) => {
      // Invalidate so a retry attempts the network again.
      cache.delete(channelId)
      throw err
    })
  cache.set(channelId, fetched)
  return fetched
}
