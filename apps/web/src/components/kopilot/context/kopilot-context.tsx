// apps/web/src/components/kopilot/context/kopilot-context.tsx

'use client'

import { useEffect, useId } from 'react'
import { useKopilotStore } from '../stores/kopilot-store'
import type { ContextChip, ContextChipIcon, ContextSlice, SessionContext } from './types'

interface KopilotContextProps {
  /** Top-level page identifier — set on the page root only. Never produces a chip. */
  page?: string

  activeThreadId?: string
  activeThreadLabel?: string

  activeContactId?: string
  activeContactLabel?: string

  activeRecordId?: string
  activeRecordLabel?: string

  activeMeetingId?: string
  activeMeetingLabel?: string

  activeCallRecordingId?: string
  activeCallRecordingLabel?: string

  activeTranscriptCallRecordingId?: string
  activeTranscriptSelectionStartMs?: number
  activeTranscriptSelectionEndMs?: number
  activeTranscriptSelectionLabel?: string

  activeFilters?: Record<string, unknown>
  activeFiltersLabel?: string
}

interface FieldDef {
  field: keyof SessionContext
  value: string | undefined
  label: string | undefined
  icon: ContextChipIcon
}

/**
 * Distributed page-context contributor. Mount one (or many) on a page; each
 * mount registers a slice while alive and unregisters on unmount.
 *
 * Props are primitives so React's default dep-comparison drives effect re-runs;
 * no `useMemo` required at the call site.
 */
export function KopilotContext(props: KopilotContextProps): null {
  const id = useId()
  const setSlice = useKopilotStore((s) => s.setContextSlice)
  const clearSlice = useKopilotStore((s) => s.clearContextSlice)

  const {
    page,
    activeThreadId,
    activeThreadLabel,
    activeContactId,
    activeContactLabel,
    activeRecordId,
    activeRecordLabel,
    activeMeetingId,
    activeMeetingLabel,
    activeCallRecordingId,
    activeCallRecordingLabel,
    activeTranscriptCallRecordingId,
    activeTranscriptSelectionStartMs,
    activeTranscriptSelectionEndMs,
    activeTranscriptSelectionLabel,
    activeFilters,
    activeFiltersLabel,
  } = props

  useEffect(() => {
    const data: Partial<SessionContext> = {}
    if (page !== undefined) data.page = page

    const fields: FieldDef[] = [
      { field: 'activeThreadId', value: activeThreadId, label: activeThreadLabel, icon: 'mail' },
      {
        field: 'activeContactId',
        value: activeContactId,
        label: activeContactLabel,
        icon: 'user',
      },
      { field: 'activeRecordId', value: activeRecordId, label: activeRecordLabel, icon: 'file' },
      {
        field: 'activeMeetingId',
        value: activeMeetingId,
        label: activeMeetingLabel,
        icon: 'mic',
      },
      {
        field: 'activeCallRecordingId',
        value: activeCallRecordingId,
        label: activeCallRecordingLabel,
        icon: 'mic',
      },
    ]

    const chips: ContextChip[] = []

    for (const f of fields) {
      if (f.value !== undefined) {
        data[f.field] = f.value
        chips.push({ field: f.field, value: f.value, label: f.label, icon: f.icon })
      }
    }

    if (
      activeTranscriptCallRecordingId !== undefined &&
      activeTranscriptSelectionStartMs !== undefined &&
      activeTranscriptSelectionEndMs !== undefined
    ) {
      data.activeTranscriptSelection = {
        callRecordingId: activeTranscriptCallRecordingId,
        startMs: activeTranscriptSelectionStartMs,
        endMs: activeTranscriptSelectionEndMs,
      }
      chips.push({
        field: 'activeTranscriptSelection',
        value: `${activeTranscriptCallRecordingId}:${activeTranscriptSelectionStartMs}-${activeTranscriptSelectionEndMs}`,
        label:
          activeTranscriptSelectionLabel ??
          `${formatMs(activeTranscriptSelectionStartMs)}–${formatMs(activeTranscriptSelectionEndMs)}`,
        icon: 'mic',
      })
    }

    if (activeFilters !== undefined) {
      data.activeFilters = activeFilters
      chips.push({
        field: 'activeFilters',
        value: 'filters',
        label: activeFiltersLabel ?? 'Filters applied',
        icon: 'filter',
      })
    }

    const slice: ContextSlice = { data, chips }
    setSlice(id, slice)
    return () => clearSlice(id)
  }, [
    id,
    page,
    activeThreadId,
    activeThreadLabel,
    activeContactId,
    activeContactLabel,
    activeRecordId,
    activeRecordLabel,
    activeMeetingId,
    activeMeetingLabel,
    activeCallRecordingId,
    activeCallRecordingLabel,
    activeTranscriptCallRecordingId,
    activeTranscriptSelectionStartMs,
    activeTranscriptSelectionEndMs,
    activeTranscriptSelectionLabel,
    activeFilters,
    activeFiltersLabel,
    setSlice,
    clearSlice,
  ])

  return null
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
