// packages/sdk/src/runtime/reconciler/instance-id.ts

/**
 * Global instance ID counter for generating unique IDs.
 */
let instanceIdCounter = 0

/**
 * Generate a unique instance ID.
 * Each component instance gets a unique numeric ID.
 */
export function generateInstanceId(): number {
  return ++instanceIdCounter
}

/**
 * Reset the instance ID counter (useful for testing).
 */
export function resetInstanceIdCounter(): void {
  instanceIdCounter = 0
}
