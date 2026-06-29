// apps/web/src/components/agents/hooks/use-persona-realtime.ts

'use client'

import { useCallback } from 'react'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

interface UsePersonaRealtimeOptions {
  /** The agent whose persona editor is open on the detail page. */
  agentId: string
  /** Called after the fresh payload landed — bump the editor reload key here. */
  onExternalPromptChange: () => void
}

/**
 * Remount the OPEN persona editor when the agent's prompt changes server-side
 * outside the editor's own save path (today: Kopilot's `set_agent_prompt`).
 * List/meta cache invalidation is `useAgentRealtime`'s job; this hook handles
 * the part it can't: the persona editor is seed-once (TipTap reads its doc once
 * at mount and ignores `agent.prompt` prop changes), so it remounts via the
 * reload key — but only AFTER `invalidate()` resolves (tRPC awaits active-query
 * refetches), otherwise the editor re-seeds from the stale cached prompt.
 *
 * The author's own autosave does NOT trigger this: the `agent.update` mutation
 * passes its socket id as `excludeSocketId`, so the originating browser is left
 * out of the `agent:updated` broadcast. Mirrors `useProcedureRealtime`.
 *
 * Known v1 caveat: unflushed local edits inside the autosave debounce window
 * are discarded by the remount.
 */
export function usePersonaRealtime({ agentId, onExternalPromptChange }: UsePersonaRealtimeOptions) {
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event !== 'agent:updated') return
      const data = payload as { agentId?: string } | null
      if (data?.agentId !== agentId) return
      // No input filter on `getById.invalidate()` — matches both id-keyed and
      // slug-keyed cache entries in one call (the detail page keys by slug).
      void utils.agent.getById.invalidate().then(() => onExternalPromptChange())
    },
    [agentId, onExternalPromptChange, utils]
  )

  useOrgChannel({ onEvent })
}
