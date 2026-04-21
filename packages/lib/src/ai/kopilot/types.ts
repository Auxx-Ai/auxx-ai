// packages/lib/src/ai/kopilot/types.ts

/** Open-ended UI context bag. Known fields provide autocomplete; any key is valid. */
export interface SessionContext extends Record<string, unknown> {
  /** Current page the user is viewing (e.g. 'mail', 'contacts', 'workflows') */
  page?: string
  /** Active thread the user has open, if any */
  activeThreadId?: string
  /** Active contact the user has open, if any */
  activeContactId?: string
  /** Active record (generic) the user has open, if any */
  activeRecordId?: string
  /** Active filter payload the user has applied to the current page */
  activeFilters?: Record<string, unknown>
}

/**
 * Domain state carried through the Kopilot turn.
 *
 * Kept intentionally minimal: UI context + static capability descriptions only.
 * Turn-local transient state (tool results, plans, classifications) lives on
 * `state.messages` — blocks flow from tools, not from prose — so there's no
 * need to shadow them on domainState.
 */
export interface KopilotDomainState {
  /** UI context — replaced wholesale on each message via applyContext */
  context: SessionContext
  /** Human-friendly capability descriptions surfaced when the user asks what Kopilot can do */
  capabilities?: string[]
}
