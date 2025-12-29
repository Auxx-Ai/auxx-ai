'use client'

import { useState, useEffect } from 'react'

/**
 * Hook for copying text to clipboard with temporary success state
 * @param timeout - Duration in milliseconds to show copied state (default: 2000ms)
 * @returns Object containing copy function and copied state
 */
export function useCopyClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return

    const timer = setTimeout(() => {
      setCopied(false)
    }, timeout)

    return () => clearTimeout(timer)
  }, [copied, timeout])

  /**
   * Copy text to clipboard
   * @param text - Text to copy to clipboard
   */
  const copy = async (text: string) => {
    if (!navigator?.clipboard) {
      console.warn('Clipboard API not supported')
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch (error) {
      console.error('Failed to copy text:', error)
    }
  }

  return { copy, copied }
}
