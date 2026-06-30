// apps/web/src/components/kopilot/context/types.ts

/**
 * Kind discriminator mirrored from `SessionRefKind` in
 * `@auxx/lib/ai/kopilot`. Inlined because that subpath isn't exported as a
 * client-safe path. Keep in sync with the lib type.
 */
export type SessionRefKind = 'thread' | 'record' | 'resource' | 'kb' | 'article' | 'actor' | 'agent'

/** Mirror of `SessionRef` from `@auxx/lib/ai/kopilot/types`. */
export interface SessionRef {
  kind: SessionRefKind
  id: string
  label?: string
  origin: 'surface' | 'mention'
  /**
   * UI-only: when true the chip in `KopilotContextChipStrip` renders
   * without the dismiss affordance and is not selectable for keyboard
   * delete. Has no effect on the LLM payload — the backend mirror of
   * `SessionRef` (in @auxx/lib/ai/kopilot/types) does NOT need this
   * field; strip before serializing.
   */
  pinned?: boolean
}

/**
 * Mirror of `SessionContext` from `@auxx/lib/ai/kopilot/types`. Inlined
 * because that subpath isn't exported as a client-safe path. Keep in sync
 * with the lib type — adding a field here means adding it to lib first.
 */
export interface SessionContext extends Record<string, unknown> {
  page?: string
  references?: SessionRef[]
}

export type ContextChipIcon = 'mail' | 'user' | 'building' | 'mic' | 'file' | 'filter' | 'book'

/** What each `<KopilotContext>` mount writes into the store. */
export interface ContextSlice {
  /** Page identifier (only set on page roots). */
  page?: string
  /** Surface references the LLM sees + chip strip renders. */
  references: SessionRef[]
}
