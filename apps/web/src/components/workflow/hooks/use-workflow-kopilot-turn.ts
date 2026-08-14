// apps/web/src/components/workflow/hooks/use-workflow-kopilot-turn.ts

'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useWorkflowStore } from '../store/workflow-store'

/** Payload of the org-channel `workflow:kopilot-turn` event (lib `realtime/events.ts`). */
interface WorkflowKopilotTurnPayload {
  workflowAppId?: string
  turnId?: string
  phase?: 'started' | 'ended'
}

/**
 * Idle ceiling before the lock releases itself. Reset by every turn-scoped
 * event, so this only expires when the server has genuinely gone quiet — a
 * crashed or redeployed instance that will never publish `ended`.
 *
 * Sized well above a real turn: builder turns run 30–90s with long thinking
 * passes, and this is the *gap between events*, not the total. Erring long is
 * correct — releasing early would unlock the canvas under a live turn, which is
 * the bug this whole mechanism exists to prevent, whereas erring long only
 * delays recovery from a rare server death.
 */
const WATCHDOG_MS = 3 * 60 * 1000

/**
 * Drive the canvas edit lock (`workflowStore.kopilotEditing`) from the
 * server-published Kopilot turn boundary.
 *
 * WHY LOCK AT ALL: Kopilot publishes one `workflow:draft-updated` per mutation,
 * and `useWorkflowDraftRealtime` DROPS every event that arrives while the canvas
 * is dirty — no queue, no catch-up fetch. So a single user edit mid-turn leaves
 * the canvas showing a half-applied turn it believes is authoritative, and the
 * next save commits that over the rest of the agent's work. See plan 14 §6.7.
 *
 * WHY NOT `useKopilotStore().isStreaming`: that flag goes FALSE on
 * `approval-required` and true again on `assistant-message-resumed`, because it
 * describes the streaming UI rather than the turn. An approval pause is still
 * inside the turn, so a streaming-derived lock would release exactly during the
 * pause — the moment the user is most likely to touch the canvas while waiting.
 * The server boundary has no such gap (`withTurnEnd` suppresses its terminal
 * guard while an approval is pending), it survives the Kopilot drawer closing
 * (which unmounts the SSE hook entirely), and it reaches a second tab.
 *
 * Mount ONCE in the editor, beside `useWorkflowDraftRealtime` — deliberately not
 * inside `WorkflowKopilotPanel`, or closing the drawer would drop the lock.
 *
 * Fails OPEN everywhere: any uncertainty leaves the canvas editable. A stranded
 * read-only canvas is recoverable only by reload, which is worse than the race,
 * and the graph-hash CAS in `persistDraft` is still the real guard underneath.
 */
export function useWorkflowKopilotTurn(workflowAppId?: string): void {
  const setKopilotEditing = useWorkflowStore((state) => state.setKopilotEditing)

  // The turn currently holding the canvas. Held in a ref, not state: it is
  // bookkeeping for the handlers below and must not re-render the editor.
  const activeTurnRef = useRef<string | null>(null)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const utils = api.useUtils()

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const release = useCallback(() => {
    clearWatchdog()
    activeTurnRef.current = null
    setKopilotEditing(false)
  }, [clearWatchdog, setKopilotEditing])

  /**
   * (Re)arm the idle watchdog. Skipped entirely while a tool approval is
   * pending: the server correctly keeps the turn open across that pause, but no
   * events flow while the user decides, so an idle timer would read a
   * legitimate wait as a dead server and unlock mid-turn. This is the one place
   * the local streaming state is the right input — as a watchdog SUPPRESSOR,
   * never as the lock source.
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
    (turnId: string) => {
      activeTurnRef.current = turnId
      setKopilotEditing(true)
      armWatchdog()
    },
    [setKopilotEditing, armWatchdog]
  )

  /**
   * Ask the server whether a turn is open. Used on mount and on every
   * (re)subscribe — a release published while the socket was down is never
   * replayed, so after a reconnect the local flag cannot be trusted in either
   * direction.
   */
  const rederive = useCallback(async () => {
    if (!workflowAppId) return
    try {
      const status = await utils.workflow.kopilotTurnStatus.fetch({ workflowAppId })
      if (status.active && status.turnId) {
        engage(status.turnId)
      } else {
        release()
      }
    } catch {
      // Fail open — an unreachable status check must not hold the canvas.
      release()
    }
  }, [workflowAppId, utils, engage, release])

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'workflow:kopilot-turn') return
      const data = (payload ?? {}) as WorkflowKopilotTurnPayload
      if (!workflowAppId || data.workflowAppId !== workflowAppId) return
      if (!data.turnId) return

      if (data.phase === 'started') {
        engage(data.turnId)
        return
      }
      if (data.phase === 'ended') {
        // Ignore an `ended` for a turn we never saw start: a late release from
        // a superseded turn must not unlock the canvas under the live one.
        if (activeTurnRef.current && activeTurnRef.current !== data.turnId) return
        release()
      }
    },
    [workflowAppId, engage, release]
  )

  // Every draft write of the open turn is proof the server is alive — push the
  // watchdog out rather than letting a long turn time itself out.
  const onDraftEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'workflow:draft-updated') return
      const data = (payload ?? {}) as { workflowAppId?: string }
      if (!workflowAppId || data.workflowAppId !== workflowAppId) return
      if (activeTurnRef.current) armWatchdog()
    },
    [workflowAppId, armWatchdog]
  )

  useOrgChannel({
    onEvent: (event, payload) => {
      onEvent(event, payload)
      onDraftEvent(event, payload)
    },
    onSubscribed: () => {
      void rederive()
    },
  })

  // Mount catch-up (a turn already running when the builder opened) and the
  // unmount release — the store is a module singleton, so a lock left set here
  // would clamp the NEXT workflow the user opens.
  useEffect(() => {
    void rederive()
    return () => release()
  }, [rederive, release])
}

/**
 * Whether the chat is parked on a tool approval. Read imperatively off the
 * store — subscribing would re-render the editor on every Kopilot message.
 */
function hasPendingApproval(): boolean {
  return useKopilotStore
    .getState()
    .messages.some((message) => message.approval?.status === 'pending')
}
