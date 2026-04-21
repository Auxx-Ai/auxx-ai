// apps/web/src/components/kopilot/hooks/kopilot-session-cache.ts

import type { api } from '~/trpc/react'
import { KOPILOT_SESSIONS_QUERY_INPUT } from './use-kopilot-sessions'

type TrpcUtils = ReturnType<typeof api.useUtils>

/**
 * Optimistically insert (or replace) a session in the listSessions cache so the
 * picker can resolve its label immediately — no waiting on the 30s staleTime.
 *
 * `createdAt` is an ISO string on the SSE wire; we hydrate it to a Date to keep
 * the array homogeneous with tRPC-deserialized rows.
 */
export function upsertSessionInListCache(
  utils: TrpcUtils,
  input: { sessionId: string; title: string; createdAt?: string }
) {
  const createdAt = input.createdAt ? new Date(input.createdAt) : new Date()

  utils.kopilot.listSessions.setData(KOPILOT_SESSIONS_QUERY_INPUT, (old) => {
    const newRow = {
      id: input.sessionId,
      title: input.title,
      type: 'kopilot' as const,
      createdAt,
      updatedAt: createdAt,
    }

    if (!old) return { items: [newRow], nextCursor: undefined }

    // Dedup: if a refetch raced us, replace in place instead of duplicating.
    const existingIdx = old.items.findIndex((s) => s.id === input.sessionId)
    if (existingIdx >= 0) {
      const next = [...old.items]
      next[existingIdx] = { ...next[existingIdx], ...newRow }
      return { ...old, items: next }
    }

    const items = [newRow, ...old.items].slice(0, KOPILOT_SESSIONS_QUERY_INPUT.limit)
    return { ...old, items }
  })
}

/**
 * Patch a session's title in the listSessions cache. Falls back to a full
 * invalidate if the row isn't on the first page (e.g. scrolled out via churn).
 */
export function patchSessionTitleInListCache(
  utils: TrpcUtils,
  input: { sessionId: string; title: string }
) {
  utils.kopilot.listSessions.setData(KOPILOT_SESSIONS_QUERY_INPUT, (old) => {
    if (!old) return old
    const idx = old.items.findIndex((s) => s.id === input.sessionId)
    if (idx < 0) {
      utils.kopilot.listSessions.invalidate()
      return old
    }
    const next = [...old.items]
    next[idx] = { ...next[idx]!, title: input.title }
    return { ...old, items: next }
  })
}
