// packages/utils/src/browser.ts

/**
 * Inline script to set platform detection in <head>. Runs before first paint so
 * both the `window.__IS_MAC__` global (read by {@link isMac}) and the `is-mac`
 * class on `<html>` (used for pure-CSS icon selection, e.g. in `Kbd`) are set
 * before React hydrates — no mismatch, no visible icon flip.
 */
export const IS_MAC_SCRIPT = `(function(){var m=/Mac|iPod|iPhone|iPad/.test(navigator.platform);window.__IS_MAC__=m;if(m)document.documentElement.classList.add('is-mac')})()`

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
