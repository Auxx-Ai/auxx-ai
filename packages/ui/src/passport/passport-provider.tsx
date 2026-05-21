// packages/ui/src/passport/passport-provider.tsx
'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { FetchPassport, PassportContextValue, StoredPassport } from './types'

const DEFAULT_EXPIRY_BUFFER_MS = 5 * 60 * 1000

export const PassportContext = createContext<PassportContextValue | null>(null)

interface PassportProviderProps {
  /** Stable identifier for this passport's scope (shareToken / channelId). Used as the storage key suffix. */
  scopeKey: string
  /** localStorage key prefix (e.g. 'auxx_passport_workflow_' or 'auxx_passport_chat_'). */
  storageKeyPrefix: string
  /** Fetches a fresh passport for the given scope key. */
  fetchPassport: FetchPassport
  /** Ms before `expiresAt` at which a stored passport is treated as expired. */
  expiryBufferMs?: number
  /** Skip auto-loading on mount — caller invokes `refresh()` manually. */
  manual?: boolean
  children: ReactNode
}

function readStored(storageKey: string): StoredPassport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    return JSON.parse(raw) as StoredPassport
  } catch {
    return null
  }
}

function writeStored(storageKey: string, data: StoredPassport): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(data))
  } catch {
    // Ignore storage errors (quota, disabled, ...)
  }
}

function clearStored(storageKey: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Ignore storage errors
  }
}

function isStillValid(stored: StoredPassport, bufferMs: number): boolean {
  const expiresAt = new Date(stored.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return false
  return expiresAt - Date.now() > bufferMs
}

/**
 * Provider managing a scope-bound JWT passport in localStorage with
 * auto-fetch, expiry validation, and a single-flight guard.
 *
 * Pure React — no Zustand, shadcn, or Tailwind. Safe to use under the
 * `preact/compat` alias in the Phase 2b chat-widget bundle.
 */
export function PassportProvider({
  scopeKey,
  storageKeyPrefix,
  fetchPassport,
  expiryBufferMs = DEFAULT_EXPIRY_BUFFER_MS,
  manual = false,
  children,
}: PassportProviderProps) {
  const storageKey = `${storageKeyPrefix}${scopeKey}`

  const [passport, setPassport] = useState<string | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const inFlightRef = useRef<Promise<void> | null>(null)
  const initializedRef = useRef<string | null>(null)

  const initialize = useCallback(
    async (force: boolean): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current

      const run = (async () => {
        setIsLoading(true)
        setError(null)
        try {
          if (!force) {
            const stored = readStored(storageKey)
            if (stored && isStillValid(stored, expiryBufferMs)) {
              setPassport(stored.passport)
              setSubjectId(stored.subjectId)
              return
            }
          } else {
            clearStored(storageKey)
          }

          const data = await fetchPassport(scopeKey)
          writeStored(storageKey, data)
          setPassport(data.passport)
          setSubjectId(data.subjectId)
        } catch (e) {
          clearStored(storageKey)
          setPassport(null)
          setSubjectId(null)
          setError((e as Error).message || 'Failed to load passport')
        } finally {
          setIsLoading(false)
        }
      })()

      inFlightRef.current = run
      try {
        await run
      } finally {
        inFlightRef.current = null
      }
    },
    [storageKey, scopeKey, fetchPassport, expiryBufferMs]
  )

  const refresh = useCallback(() => initialize(true), [initialize])

  useEffect(() => {
    if (manual) return
    // Re-run when scopeKey changes; ignore strict-mode double-invoke for same key.
    if (initializedRef.current === scopeKey) return
    initializedRef.current = scopeKey
    void initialize(false)
  }, [scopeKey, manual, initialize])

  const value = useMemo<PassportContextValue>(
    () => ({ passport, subjectId, isLoading, error, refresh }),
    [passport, subjectId, isLoading, error, refresh]
  )

  return <PassportContext.Provider value={value}>{children}</PassportContext.Provider>
}
