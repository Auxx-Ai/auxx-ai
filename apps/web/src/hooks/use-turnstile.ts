// apps/web/src/hooks/use-turnstile.ts
'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Hook to manage Turnstile token lifecycle for auth forms.
 *
 * Token states:
 * - null: widget loading or expired (submit should be disabled)
 * - string: valid token ready to send
 *
 * After a failed submission, call `reset()` to re-verify.
 * The widget auto-resets on expiry via `onExpire`.
 */
export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null)
  const widgetRef = useRef<{ reset: () => void } | null>(null)

  const onSuccess = useCallback((t: string) => setToken(t), [])

  const onExpire = useCallback(() => {
    setToken(null)
    widgetRef.current?.reset()
  }, [])

  const onError = useCallback(() => {
    setToken(null)
  }, [])

  /** Call after a failed form submission to get a fresh token */
  const reset = useCallback(() => {
    setToken(null)
    widgetRef.current?.reset()
  }, [])

  return { token, onSuccess, onExpire, onError, reset, widgetRef }
}
