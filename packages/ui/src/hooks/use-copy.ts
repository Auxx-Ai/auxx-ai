// packages/ui/src/hooks/use-copy.ts

'use client'

import { useCallback, useState, useRef } from 'react'
import { toastSuccess } from '../components/toast'

interface UseCopyOptions {
  /** Toast message to show on successful copy */
  toastMessage?: string
  /** Duration in ms before copied state resets (default: 2000) */
  resetDelay?: number
  /** Whether to auto-reset the copied state (default: true) */
  autoReset?: boolean
}

interface UseCopyReturn {
  /** Whether the content was recently copied */
  copied: boolean
  /** Copy the given text to clipboard */
  copy: (text: string) => void
  /** Manually reset the copied state */
  reset: () => void
}

/**
 * Hook for copying text to clipboard with toast notification and copied state
 */
export function useCopy(options: UseCopyOptions = {}): UseCopyReturn {
  const { toastMessage = 'Copied to clipboard', resetDelay = 2000, autoReset = true } = options
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setCopied(false)
  }, [])

  const copy = useCallback(
    (text: string) => {
      if (!text) return

      navigator.clipboard.writeText(text)
      setCopied(true)
      toastSuccess({ title: toastMessage })

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      if (autoReset) {
        timeoutRef.current = setTimeout(() => {
          setCopied(false)
        }, resetDelay)
      }
    },
    [toastMessage, resetDelay, autoReset]
  )

  return { copied, copy, reset }
}
