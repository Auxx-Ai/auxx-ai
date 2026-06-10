// apps/web/src/components/agents/procedures/hooks/use-procedure-realtime.ts

'use client'

import { useCallback } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useOrgChannel } from '~/realtime/hooks'
import { api } from '~/trpc/react'

interface UseProcedureRealtimeOptions {
  /** The procedure currently open in the editor, if any. */
  selectedProcedureId: string | null
  /** Called after the fresh payload landed — bump the editor reload key here. */
  onExternalDraftChange: () => void
}

/**
 * Reload the OPEN procedure editor when its draft changes server-side outside
 * the editor's own save path (today: Kopilot authoring tools). List/meta cache
 * invalidation is `useAgentRealtime`'s job; this hook handles the part it
 * can't: the editor's draft doc is seed-once, so it remounts via the reload
 * key — but only AFTER `invalidate()` resolves (tRPC awaits active-query
 * refetches), otherwise the editor re-seeds from the stale cached doc.
 *
 * Known v1 caveat: unflushed local edits inside the autosave debounce window
 * are discarded by the remount. The reverse direction is hash-guarded
 * (an editor autosave makes the chat write fail as STALE_DRAFT).
 */
export function useProcedureRealtime({
  selectedProcedureId,
  onExternalDraftChange,
}: UseProcedureRealtimeOptions) {
  const { hasAccess } = useFeatureFlags()
  const realtimeSyncEnabled = hasAccess('realtimeSync')
  const utils = api.useUtils()

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      if (!realtimeSyncEnabled) return
      if (event !== 'procedure:updated' || !selectedProcedureId) return
      const data = payload as { procedureId?: string } | null
      if (data?.procedureId !== selectedProcedureId) return
      void utils.procedure.getById
        .invalidate({ id: selectedProcedureId })
        .then(() => onExternalDraftChange())
    },
    [realtimeSyncEnabled, selectedProcedureId, onExternalDraftChange, utils]
  )

  useOrgChannel({ onEvent })
}
