// apps/web/src/hooks/use-dirty-state.tsx
'use client'

import { useCallback, useMemo, useState } from 'react'

/**
 * Default shallow comparison for objects.
 * Normalizes empty strings to undefined for comparison.
 */
function defaultCompare<T>(a: T, b: T): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return a === b
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const allKeys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])

  for (const key of allKeys) {
    const aVal = aObj[key]
    const bVal = bObj[key]
    // Normalize empty string to undefined
    const normalizedA = aVal === '' ? undefined : aVal
    const normalizedB = bVal === '' ? undefined : bVal
    if (normalizedA !== normalizedB) return false
  }
  return true
}

/**
 * Options for dirty state tracking
 */
interface UseDirtyStateOptions<T> {
  /** Initial/baseline value to compare against */
  initialValue: T
  /** Optional custom comparison function */
  compare?: (a: T, b: T) => boolean
}

/**
 * Return type for dirty state hook
 */
interface UseDirtyStateReturn<T> {
  /** Current value */
  value: T
  /** Update the current value */
  setValue: React.Dispatch<React.SetStateAction<T>>
  /** Whether current value differs from initial */
  isDirty: boolean
  /** Reset to initial value */
  reset: () => void
  /** Update the baseline (e.g., after successful save) */
  setBaseline: (newBaseline: T) => void
}

/**
 * Hook to track dirty state by comparing current value against a baseline.
 * Includes value state management.
 *
 * @example
 * ```tsx
 * const { value, setValue, isDirty, reset, setBaseline } = useDirtyState({
 *   initialValue: { name: '', email: '' },
 * })
 *
 * // After successful save:
 * setBaseline(value)
 * ```
 */
export function useDirtyState<T>({
  initialValue,
  compare = defaultCompare,
}: UseDirtyStateOptions<T>): UseDirtyStateReturn<T> {
  const [value, setValue] = useState<T>(initialValue)
  const [baseline, setBaseline] = useState<T>(initialValue)

  const isDirty = useMemo(() => !compare(value, baseline), [value, baseline, compare])

  const reset = useCallback(() => {
    setValue(baseline)
  }, [baseline])

  return {
    value,
    setValue,
    isDirty,
    reset,
    setBaseline,
  }
}

/**
 * Return type for dirty check hook
 */
interface UseDirtyCheckReturn<T> {
  /** Whether current value differs from initial */
  isDirty: boolean
  /** Set the initial/baseline value to compare against */
  setInitial: (value: T) => void
  /** Reset initial to current value */
  resetInitial: () => void
  /** The stored initial value */
  initial: T
}

/**
 * Simpler hook for tracking dirty state with external value management.
 * Use when you already have your own value state.
 *
 * @example
 * ```tsx
 * const [values, setValues] = useState({})
 * const { isDirty, setInitial } = useDirtyCheck(values)
 *
 * useEffect(() => {
 *   if (open) setInitial(loadedValues)
 * }, [open])
 * ```
 */
export function useDirtyCheck<T>(
  currentValue: T,
  compare: (a: T, b: T) => boolean = defaultCompare
): UseDirtyCheckReturn<T> {
  const [initial, setInitial] = useState<T>(currentValue)

  const isDirty = useMemo(() => !compare(currentValue, initial), [currentValue, initial, compare])

  const resetInitial = useCallback(() => {
    setInitial(currentValue)
  }, [currentValue])

  return {
    isDirty,
    setInitial,
    resetInitial,
    initial,
  }
}
