// packages/lib/src/health/state-manager.ts

/** Last-known-state cache for a single health indicator */
export class HealthStateManager {
  private lastKnownState: {
    timestamp: Date
    details: Record<string, unknown>
  } | null = null

  /** Update with a fresh successful result */
  updateState(details: Record<string, unknown>) {
    this.lastKnownState = { timestamp: new Date(), details }
  }

  /** Get the last known state with age in ms, or null if never succeeded */
  getStateWithAge(): { timestamp: Date; details: Record<string, unknown>; ageMs: number } | null {
    if (!this.lastKnownState) return null
    return {
      ...this.lastKnownState,
      ageMs: Date.now() - this.lastKnownState.timestamp.getTime(),
    }
  }
}
