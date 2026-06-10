// apps/web/src/components/kopilot/stores/task-watch-store.ts
//
// Watches for async tasks started by Kopilot tools (output carried a
// `taskNotification: { kind, ref }`). One generic store keyed
// (sessionId, kind, ref); per-kind terminal detection plugs in via watcher
// components in `hooks/use-task-watchers`. Not persisted — replay-on-load
// rebuilds watches from session history. See plans/kopilot/task-notifications.

import { create } from 'zustand'

export type TaskWatchState =
  /** Task still running — a kind watcher is polling its status. */
  | 'watching'
  /** Terminal — a notification intent is queued, waiting for an idle session. */
  | 'terminal-queued'
  /** Notification POSTed (or found already delivered). Nothing left to do. */
  | 'done'

export interface TaskWatch {
  sessionId: string
  kind: string
  ref: string
  state: TaskWatchState
}

export function taskWatchKey(watch: Pick<TaskWatch, 'sessionId' | 'kind' | 'ref'>): string {
  return `${watch.sessionId}:${watch.kind}:${watch.ref}`
}

interface TaskWatchStore {
  watches: Record<string, TaskWatch>
  /** Idempotent — an existing watch (any state) is left untouched. */
  registerWatch: (watch: Pick<TaskWatch, 'sessionId' | 'kind' | 'ref'>) => void
  markTerminal: (key: string) => void
  markDone: (key: string) => void
  /** Drain hit a not-terminal-yet race (422) — resume polling. */
  resumeWatching: (key: string) => void
}

export const useTaskWatchStore = create<TaskWatchStore>()((set) => ({
  watches: {},

  registerWatch: (watch) =>
    set((s) => {
      const key = taskWatchKey(watch)
      if (s.watches[key]) return s
      return { watches: { ...s.watches, [key]: { ...watch, state: 'watching' } } }
    }),

  markTerminal: (key) =>
    set((s) => {
      const existing = s.watches[key]
      if (!existing || existing.state !== 'watching') return s
      return { watches: { ...s.watches, [key]: { ...existing, state: 'terminal-queued' } } }
    }),

  markDone: (key) =>
    set((s) => {
      const existing = s.watches[key]
      if (!existing || existing.state === 'done') return s
      return { watches: { ...s.watches, [key]: { ...existing, state: 'done' } } }
    }),

  resumeWatching: (key) =>
    set((s) => {
      const existing = s.watches[key]
      if (!existing || existing.state === 'done') return s
      return { watches: { ...s.watches, [key]: { ...existing, state: 'watching' } } }
    }),
}))
