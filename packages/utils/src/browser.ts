// packages/utils/src/browser.ts

/**
 * Inline script to set platform detection in <head>.
 * Run this before React hydration to avoid mismatch.
 */
export const IS_MAC_SCRIPT = `window.__IS_MAC__=/Mac|iPod|iPhone|iPad/.test(navigator.platform)`

/**
 * Check if the current platform is macOS/iOS.
 * Reads from the global set by IS_MAC_SCRIPT in <head>.
 * Falls back to navigator check if global not set.
 */
export function isMac(): boolean {
  if (typeof window === 'undefined') return false

  // Prefer the pre-computed global (set in <head>)
  if (typeof (window as any).__IS_MAC__ === 'boolean') {
    return (window as any).__IS_MAC__
  }

  // Fallback: compute at runtime
  return /Mac|iPod|iPhone|iPad/.test(window.navigator.platform)
}
