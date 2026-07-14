// apps/web/src/components/sequences/hooks/use-sequence-step-autosave.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutosaveState } from '~/components/agents/ui/shared/autosave-indicator'
import { api } from '~/trpc/react'

const AUTOSAVE_DELAY_MS = 750

/** Patchable fields accepted by `api.sequence.updateStep`. */
export interface SequenceUpdateStepFields {
  subject?: string | null
  bodyJson?: Record<string, unknown> | null
  bodyHtml?: string | null
  delayDays?: number
  delayHours?: number
  attachmentIds?: string[]
}

interface UseSequenceStepAutosaveOptions {
  sequenceId: string
  stepId: string
}

/**
 * Debounced (750ms) autosave for one sequence step's mutable fields, with a
 * `flush` escape hatch for on-blur commits. Multiple fields changed in quick
 * succession (subject + body, or two delay inputs) coalesce into a single
 * `updateStep` call. On success the saved step + the parent sequence's
 * `hasUnpublishedChanges` flag are patched into the `sequence.get` cache —
 * never invalidated. The cards/editors are seed-once so the patch can't
 * clobber in-progress typing, but the cache MUST track saves: a remount
 * (e.g. tab switch) re-seeds from it, and a stale cache would resurrect
 * pre-autosave text.
 */
export function useSequenceStepAutosave({ sequenceId, stepId }: UseSequenceStepAutosaveOptions) {
  const utils = api.useUtils()
  const [state, setState] = useState<AutosaveState>({ kind: 'idle' })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<SequenceUpdateStepFields | null>(null)

  const updateStep = api.sequence.updateStep.useMutation({
    onSuccess: (updated) => {
      setState({ kind: 'saved', at: Date.now() })
      utils.sequence.get.setData({ id: sequenceId }, (old) => {
        if (!old) return old
        const steps = old.steps.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        const sequence =
          old.sequence.hasUnpublishedChanges || !old.sequence.publishedAt
            ? old.sequence
            : { ...old.sequence, hasUnpublishedChanges: true }
        return { sequence, steps }
      })
    },
    onError: (error) => {
      setState({ kind: 'idle' })
      toastError({ title: 'Failed to save step', description: error.message })
    },
  })

  // Latest mutate/stepId via refs so `schedule`/`flush` stay referentially
  // stable (they're passed into editor onChange handlers) without stale closures.
  const mutateRef = useRef(updateStep.mutate)
  mutateRef.current = updateStep.mutate
  const stepIdRef = useRef(stepId)
  stepIdRef.current = stepId

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    const fields = pendingRef.current
    if (!fields) return
    pendingRef.current = null
    setState({ kind: 'saving' })
    mutateRef.current({ stepId: stepIdRef.current, fields })
  }, [])

  const schedule = useCallback(
    (fields: SequenceUpdateStepFields) => {
      pendingRef.current = { ...pendingRef.current, ...fields }
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS)
    },
    [flush]
  )

  // Flush pending edits on unmount (e.g. deleting a different step remounts the list).
  // biome-ignore lint/correctness/useExhaustiveDependencies: flush is stable
  useEffect(() => flush, [])

  return useMemo(() => ({ schedule, flush, state }), [schedule, flush, state])
}
