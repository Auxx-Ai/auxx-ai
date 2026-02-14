// apps/web/src/components/threads/context/keyboard-context.tsx
'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from 'react'

type KeyCombo = string // e.g., 'ArrowDown', 'Meta+a', 'Shift+ArrowUp'
type KeyCallback = (event: KeyboardEvent) => void

interface KeyboardContextValue {
  register: (combo: KeyCombo, callback: KeyCallback, priority?: number) => () => void
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null)

/**
 * Checks if the active element is an input-type element where shortcuts should be disabled.
 */
function isInputElement(element: Element | null): boolean {
  if (!element) return false
  const tagName = element.tagName
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    (element.hasAttribute('contenteditable') &&
      element.getAttribute('contenteditable') !== 'false') ||
    element.getAttribute('role') === 'textbox'
  )
}

/**
 * Checks if user has text selected (for native copy/paste).
 */
function hasActiveTextSelection(): boolean {
  const selection = window.getSelection()
  return !!(selection && selection.rangeCount > 0 && selection.toString().trim().length > 0)
}

/**
 * Builds a normalized key combo string from a keyboard event.
 * Format: "Meta+Shift+ArrowDown" (modifiers sorted alphabetically)
 */
function buildComboString(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.altKey) parts.push('Alt')
  if (e.ctrlKey) parts.push('Control')
  if (e.metaKey) parts.push('Meta')
  if (e.shiftKey) parts.push('Shift')
  parts.push(e.key)
  return parts.join('+')
}

interface KeyboardProviderProps {
  children: ReactNode
  /** If true, all keyboard shortcuts are disabled */
  disabled?: boolean
}

/**
 * Provider that manages a single document-level keyboard listener.
 * All keyboard shortcuts in the app register through this context.
 */
export function KeyboardProvider({ children, disabled = false }: KeyboardProviderProps) {
  // Map of key combo -> Set of { callback, priority }
  const callbacksRef = useRef<Map<string, Set<{ callback: KeyCallback; priority: number }>>>(
    new Map()
  )

  const register = useCallback((combo: KeyCombo, callback: KeyCallback, priority = 0) => {
    if (!callbacksRef.current.has(combo)) {
      callbacksRef.current.set(combo, new Set())
    }
    const entry = { callback, priority }
    callbacksRef.current.get(combo)!.add(entry)

    // Return unregister function
    return () => {
      const set = callbacksRef.current.get(combo)
      if (set) {
        set.delete(entry)
        if (set.size === 0) {
          callbacksRef.current.delete(combo)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (disabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if focused on input element
      if (isInputElement(document.activeElement)) return

      // Skip copy/paste shortcuts if text is selected (allow native behavior)
      if (
        hasActiveTextSelection() &&
        (e.key === 'c' || e.key === 'x' || e.key === 'v') &&
        (e.metaKey || e.ctrlKey)
      ) {
        return
      }

      const combo = buildComboString(e)
      const entries = callbacksRef.current.get(combo)

      if (entries && entries.size > 0) {
        // Sort by priority (highest first) and execute highest only
        const sorted = Array.from(entries).sort((a, b) => b.priority - a.priority)
        const highest = sorted[0]
        if (highest) {
          highest.callback(e)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled])

  return <KeyboardContext.Provider value={{ register }}>{children}</KeyboardContext.Provider>
}

/**
 * Hook to register a keyboard shortcut.
 *
 * @param combo - Key combination string (e.g., 'ArrowDown', 'Meta+a')
 * @param callback - Function to call when the key combo is pressed
 * @param options - { enabled, priority }
 */
export function useKeyboard(
  combo: KeyCombo,
  callback: KeyCallback,
  options?: { enabled?: boolean; priority?: number }
) {
  const { enabled = true, priority = 0 } = options ?? {}
  const ctx = useContext(KeyboardContext)

  // Use ref to avoid re-registering when callback identity changes
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!ctx || !enabled) return

    const stableCallback = (e: KeyboardEvent) => callbackRef.current(e)
    return ctx.register(combo, stableCallback, priority)
  }, [ctx, combo, enabled, priority])
}

/**
 * Hook to access the keyboard context directly.
 * Throws if used outside of KeyboardProvider.
 */
export function useKeyboardContext() {
  const ctx = useContext(KeyboardContext)
  if (!ctx) {
    throw new Error('useKeyboardContext must be used within a KeyboardProvider')
  }
  return ctx
}
