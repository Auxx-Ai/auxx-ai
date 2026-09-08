// apps/web/src/components/dashboard/hooks/use-dashboard-kopilot-turn.ts

'use client'

// The client half of the dashboard turn lock (plan v3/03 §1-2, v3/04 §6). While
// a Kopilot turn holds a dashboard's draft server-side, the canvas goes
// read-only and auto-save suspends; this module is where the page learns that.
//
// WHY A MODULE SINGLETON rather than the draft store: the store is owned by
// another agent's file and this is not draft state — it is a server fact about
// a dashboard that outlives any one component. It is a module singleton for
// exactly the reason the draft store is (one dashboard is open at a time), and
// it is keyed by dashboard id so a lock left set for one dashboard can never
// clamp the next one the user opens.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

/** Payload of the org-channel `dashboard:kopilot-turn` event (lib `realtime/events.ts`). */
interface DashboardKopilotTurnPayload {
  dashboardId?: string
  turnId?: string
  phase?: 'started' | 'ended'
}

/**
 * Idle ceiling before the lock releases itself locally. Reset by every
 * turn-scoped event, so it only expires when the server has genuinely gone
 * quiet: a crashed or redeployed instance that will never publish `ended`.
 *
 * Sized well above a real turn, and deliberately so. This is the gap BETWEEN
 * events, not the total, and releasing early would unlock the canvas under a
 * live turn, which is the bug the whole mechanism exists to prevent. Erring
 * long only delays recovery from a rare server death; the 15 minute Redis TTL
 * is the slower of the two safety nets underneath it.
 */
const WATCHDOG_MS = 3 * 60 * 1000

/**
 * The Kopilot turn currently holding a dashboard's draft, or `null` when the
 * canvas is the user's.
 *
 * Deliberately NOT carrying "the last turn that ended". The Undo offer derives
 * its turn id server-side from the snapshot slot (`dashboard.kopilotTurnReview`)
 * because the outcome that most often leaves a snapshot is `aborted`, and
 * `aborted` IS a reload or navigate-away: the client that would have remembered
 * the id is exactly the one that no longer exists.
 */
export type DashboardTurnLock = { turnId: string; startedAt: number } | null

/**
 * The live lock, plus the dashboard it belongs to. Snapshot identity is stable
 * between writes because `useSyncExternalStore` compares by reference.
 */
let currentDashboardId: string | null = null
let current: DashboardTurnLock = null
const listeners = new Set<() => void>()

function publish(next: DashboardTurnLock): void {
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): DashboardTurnLock {
  return current
}

/** SSR renders an unlocked canvas: the lock is a live server fact, never markup. */
function serverSnapshot(): DashboardTurnLock {
  return null
}

/**
 * Imperative read for the auto-save flush, which must NOT subscribe: it runs
 * inside a debounce callback and an unmount cleanup, neither of which is a
 * render. Answers `null` for any dashboard other than the one the lock is
 * tracking, so a stale lock can never suspend a different dashboard's save.
 */
export function getDashboardTurnLock(dashboardId: string | null): DashboardTurnLock {
  if (!dashboardId || currentDashboardId !== dashboardId) return null
  return current
}

/**
 * Reactive read for the canvas clamp, the header cluster and the pill. Answers
 * `null` for any dashboard but the tracked one.
 */
export function useDashboardTurnLock(dashboardId: string | null): DashboardTurnLock {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  if (!dashboardId || currentDashboardId !== dashboardId) return null
  return state
}

/**
 * Drive the lock from the server-published turn boundary. Mount ONCE per open
 * dashboard, beside `useDashboardAutosave` and `useDashboardDraftRealtime`.
 *
 * WHY LOCK AT ALL: the dashboard page auto-saves the WHOLE layout document on
 * an 800ms debounce, so a flush holding a pre-turn doc is a complete overwrite
 * of everything the agent wrote. The hash CAS turns that from a silent loss
 * into a visible conflict; this is what stops it being a conflict the user has
 * to think about. `useDashboardDraftRealtime` also drops every `draft-updated`
 * that lands while the canvas is dirty, so one user edit mid-turn otherwise
 * strands the page on a half-applied turn it believes is authoritative.
 *
 * WHY NOT `useKopilotStore().isStreaming`: that flag goes FALSE on
 * `approval-required` and true again on resume, because it describes the
 * streaming UI rather than the turn. An approval pause is still inside the
 * turn, so a streaming-derived lock would release exactly during the pause,
 * the moment the user is most likely to fiddle with the canvas while waiting.
 * The server boundary has no such gap, survives the Kopilot dock closing, and
 * reaches a second tab.
 *
 * NOTE the lock is claimed on the first tool call of ANY kind, reads included
 * (plan v3/03 §1): the dirty gate reads `isDirty` as captured when the message
 * was SENT, so locking only on the first write leaves the send-to-first-write
 * window open. A question-only turn therefore locks the canvas too, which is
 * why the pill says "working" until a write actually lands.
 *
 * Fails OPEN everywhere: any uncertainty leaves the canvas editable. A stranded
 * read-only canvas is recoverable only by reload, which is worse than the race,
 * and the CAS in `saveDraft` is still the real guard underneath.
 */
export function useDashboardKopilotTurn(dashboardId: string | null): void {
  const utils = api.useUtils()
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const release = useCallback(() => {
    clearWatchdog()
    publish(null)
  }, [clearWatchdog])

  /**
   * (Re)arm the idle watchdog. Skipped while a tool approval is pending: the
   * server correctly keeps the turn open across that pause, but no events flow
   * while the user decides, so an idle timer would read a legitimate wait as a
   * dead server and unlock mid-turn. This is the one place the local streaming
   * state is the right input, as a watchdog SUPPRESSOR and never as the lock.
   */
  const armWatchdog = useCallback(() => {
    clearWatchdog()
    watchdogRef.current = setTimeout(() => {
      if (hasPendingApproval()) {
        armWatchdog()
        return
      }
      release()
    }, WATCHDOG_MS)
  }, [clearWatchdog, release])

  const engage = useCallback(
    (turnId: string, startedAt: number) => {
      if (current?.turnId !== turnId) publish({ turnId, startedAt })
      armWatchdog()
    },
    [armWatchdog]
  )

  /**
   * Ask the server whether a turn is open. Runs on mount (a turn may already
   * have been running when the page opened) and on every (re)subscribe.
   */
  const rederive = useCallback(async () => {
    if (!dashboardId) return
    try {
      // `staleTime: 0`: a cached answer from before the disconnect is exactly
      // the thing this call exists to distrust.
      const status = await utils.dashboard.kopilotTurnStatus.fetch(
        { dashboardId },
        { staleTime: 0 }
      )
      if (currentDashboardId !== dashboardId) return
      if (status.active && status.turnId) {
        engage(status.turnId, status.startedAt ?? Date.now())
      } else {
        release()
      }
    } catch {
      // Fail open: an unreachable status check must not hold the canvas.
      release()
    }
  }, [dashboardId, utils, engage, release])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (!dashboardId) return

      if (event === 'dashboard:draft-updated') {
        // Every draft write of the open turn is proof the server is alive: push
        // the watchdog out rather than letting a long turn time itself out.
        const data = (payload ?? {}) as { dashboardId?: string }
        if (data.dashboardId === dashboardId && current) armWatchdog()
        return
      }
      if (event !== 'dashboard:kopilot-turn') return

      const data = (payload ?? {}) as DashboardKopilotTurnPayload
      if (data.dashboardId !== dashboardId || !data.turnId) return

      if (data.phase === 'started') {
        engage(data.turnId, Date.now())
        return
      }
      if (data.phase === 'ended') {
        // Ignore an `ended` for a turn we never saw start: a late release from a
        // superseded turn must not unlock the canvas under the live one.
        if (current && current.turnId !== data.turnId) return
        release()
      }
    },
    [dashboardId, engage, release, armWatchdog]
  )

  // Held in a ref so the bind effect below keys on `dashboardId` ALONE. Keying
  // it on the callback instead would re-run the effect whenever tRPC's utils
  // proxy re-identifies, and each re-run wipes the tracked turn.
  const rederiveRef = useRef(rederive)
  rederiveRef.current = rederive

  useOrgChannel({
    onEvent,
    onSubscribed: () => {
      void rederiveRef.current()
    },
  })

  // Bind the singleton to this dashboard BEFORE the catch-up fetch, and drop it
  // on unmount: a lock left set here would clamp the next dashboard opened.
  useEffect(() => {
    currentDashboardId = dashboardId
    publish(null)
    void rederiveRef.current()
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      watchdogRef.current = null
      currentDashboardId = null
      publish(null)
    }
  }, [dashboardId])
}

/**
 * Whether the chat is parked on a tool approval. Read imperatively off the
 * store: subscribing would re-render the canvas on every Kopilot message.
 */
function hasPendingApproval(): boolean {
  return useKopilotStore.getState().messages.some((m) => m.approval?.status === 'pending')
}
