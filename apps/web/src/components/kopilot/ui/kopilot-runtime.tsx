// apps/web/src/components/kopilot/ui/kopilot-runtime.tsx

'use client'

import { generateId } from '@auxx/utils/generateId'
import { useEffect } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useKopilotSSE } from '../hooks/use-kopilot-sse'
import { TASK_WATCHERS } from '../hooks/use-task-watchers'
import { useKopilotStore } from '../stores/kopilot-store'
import { taskWatchKey, useTaskWatchStore } from '../stores/task-watch-store'
import {
  canDrainNotification,
  findUnnotifiedTaskRefs,
  isTaskNotificationMessage,
  TASK_NOTIFICATION_ORIGIN,
} from '../utils/task-notifications'

/**
 * App-level, headless Kopilot turn runner. Owns the single SSE connection
 * keyed off the store's `pendingRequest` so turns stream into the store even
 * when no chat surface is mounted (panel closed, user navigated away) — the
 * prerequisite for task-notification delivery + the unread badge.
 *
 * Also hosts the task-notification loop: watch registration from session
 * history, per-kind status watchers, and the between-turns drain.
 * See plans/kopilot/task-notifications/plan.md §D.
 */
export function KopilotRuntime() {
  const { hasAccess } = useFeatureFlags()
  if (!hasAccess('kopilot')) return null
  return <KopilotRuntimeInner />
}

function KopilotRuntimeInner() {
  const pendingRequest = useKopilotStore((s) => s.pendingRequest)
  const setPendingRequest = useKopilotStore((s) => s.setPendingRequest)

  // The one SSE runner for every Kopilot surface.
  useKopilotSSE({
    pendingRequest,
    onRequestSent: () => setPendingRequest(null),
  })

  // ── Watch registration (live + replay-on-load in one scan) ──
  // Whenever the visible messages change, register a watch for every tool
  // output carrying `taskNotification` that has no delivered notification yet.
  // Registration is idempotent; terminal-vs-running is the watcher's job.
  const messages = useKopilotStore((s) => s.messages)
  const activeSessionId = useKopilotStore((s) => s.activeSessionId)
  const registerWatch = useTaskWatchStore((s) => s.registerWatch)

  useEffect(() => {
    if (!activeSessionId) return
    for (const task of findUnnotifiedTaskRefs(messages)) {
      registerWatch({ sessionId: activeSessionId, ...task })
    }
  }, [messages, activeSessionId, registerWatch])

  // ── Drain: terminal watch + idle session → notification turn ──
  const watches = useTaskWatchStore((s) => s.watches)
  const isStreaming = useKopilotStore((s) => s.isStreaming)

  useEffect(() => {
    const store = useKopilotStore.getState()
    const watchStore = useTaskWatchStore.getState()

    // Only the active session drains — its messages are what the store
    // renders. Watches for other sessions deliver via replay when reopened.
    const next = Object.values(watchStore.watches).find(
      (w) => w.state === 'terminal-queued' && w.sessionId === store.activeSessionId
    )
    if (!next) return
    if (!canDrainNotification(store)) return

    const key = taskWatchKey(next)

    // Client-side dedupe (the server check is authoritative — this just avoids
    // an obviously redundant POST after replay).
    if (store.messages.some((m) => isTaskNotificationMessage(m, next))) {
      watchStore.markDone(key)
      return
    }
    watchStore.markDone(key)

    // Local chip renders immediately; the server persists the canonical
    // (rewritten) message, so a reload shows the same chip from history.
    const leaf = store.messages[store.messages.length - 1]
    store.addMessage({
      id: generateId(),
      role: 'user',
      content: '',
      timestamp: Date.now(),
      parentId: leaf?.id ?? null,
      metadata: { origin: TASK_NOTIFICATION_ORIGIN, kind: next.kind, ref: next.ref },
    })

    if (!store.panelOpen) store.setHasUnreadNotification(true)

    store.setPendingRequest({
      sessionId: next.sessionId,
      // Placeholder — the route rebuilds the body from DB truth (§C.4).
      message: '<task-notification pending>',
      type: 'message',
      origin: 'task-notification',
      task: { kind: next.kind, ref: next.ref },
    })
  }, [watches, isStreaming, pendingRequest, messages, activeSessionId])

  // ── Unread badge lifecycle ──
  const panelOpen = useKopilotStore((s) => s.panelOpen)
  const hasUnreadNotification = useKopilotStore((s) => s.hasUnreadNotification)
  const setHasUnreadNotification = useKopilotStore((s) => s.setHasUnreadNotification)
  useEffect(() => {
    if (panelOpen && hasUnreadNotification) setHasUnreadNotification(false)
  }, [panelOpen, hasUnreadNotification, setHasUnreadNotification])

  // ── Per-kind status watchers (headless) ──
  const liveWatches = Object.values(watches).filter(
    (w) => w.state === 'watching' && w.sessionId === activeSessionId
  )

  return (
    <>
      {liveWatches.map((watch) => {
        const Watcher = TASK_WATCHERS[watch.kind]
        if (!Watcher) return null
        return <Watcher key={taskWatchKey(watch)} watch={watch} />
      })}
    </>
  )
}
