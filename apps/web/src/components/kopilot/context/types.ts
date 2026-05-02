// apps/web/src/components/kopilot/context/types.ts

/**
 * Mirror of `SessionContext` from `@auxx/lib/ai/kopilot/types`. Inlined because
 * that subpath isn't exported as a client-safe path. Keep in sync with the lib
 * type — adding a field here means adding it to lib first.
 */
export interface SessionContext extends Record<string, unknown> {
  page?: string
  activeThreadId?: string
  activeContactId?: string
  activeRecordId?: string
  activeMeetingId?: string
  activeCallRecordingId?: string
  activeTranscriptSelection?: { callRecordingId: string; startMs: number; endMs: number }
  activeFilters?: Record<string, unknown>
}

export type ContextChipIcon = 'mail' | 'user' | 'building' | 'mic' | 'file' | 'filter'

/** A single visible chip rendered in the composer chip strip. */
export interface ContextChip {
  /** Field key inside SessionContext that this chip represents */
  field: keyof SessionContext
  /** The id/value being claimed (recordId, threadId, etc.) */
  value: string
  /** Display label — falls back to `value` when absent (debug-only fallback) */
  label?: string
  /** Lucide icon hint chosen by field type */
  icon?: ContextChipIcon
}

/** What each `<KopilotContext>` mount writes into the store. */
export interface ContextSlice {
  /** SessionContext fields the LLM sees */
  data: Partial<SessionContext>
  /** UI chips rendered above the composer */
  chips: ContextChip[]
}
