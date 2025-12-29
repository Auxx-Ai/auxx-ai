// apps/web/src/components/workflow/share/hooks/use-workflow-passport.ts
'use client'
import { useCallback, useRef } from 'react'
import { useWorkflowShareStore } from '../workflow-share-provider'
import { useWorkflowShare } from './use-workflow-share'

const PASSPORT_STORAGE_PREFIX = 'auxx_passport_'

/**
 * Stored passport data structure
 */
interface StoredPassport {
  passport: string
  endUserId: string
  expiresAt: string
}

/**
 * Hook for managing passport lifecycle
 * - Loads from localStorage on mount
 * - Fetches new passport if expired or missing
 * - Persists to localStorage
 */
export function useWorkflowPassport(shareToken: string) {
  const passport = useWorkflowShareStore((s) => s.passport)
  const setPassport = useWorkflowShareStore((s) => s.setPassport)
  const setLoading = useWorkflowShareStore((s) => s.setLoading)
  const setError = useWorkflowShareStore((s) => s.setError)

  const { fetchPassport } = useWorkflowShare(shareToken)

  const storageKey = `${PASSPORT_STORAGE_PREFIX}${shareToken}`

  // Guard against concurrent initialization
  const isInitializingRef = useRef(false)

  /**
   * Check if stored passport is still valid
   */
  const isPassportValid = useCallback((stored: StoredPassport): boolean => {
    const expiresAt = new Date(stored.expiresAt)
    const now = new Date()
    // Consider expired if less than 5 minutes remaining
    const bufferMs = 5 * 60 * 1000
    return expiresAt.getTime() - now.getTime() > bufferMs
  }, [])

  /**
   * Load passport from localStorage
   */
  const loadStoredPassport = useCallback((): StoredPassport | null => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return null
      return JSON.parse(stored) as StoredPassport
    } catch {
      return null
    }
  }, [storageKey])

  /**
   * Save passport to localStorage
   */
  const savePassport = useCallback(
    (data: StoredPassport) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
      } catch {
        // Ignore storage errors
      }
    },
    [storageKey]
  )

  /**
   * Clear stored passport
   */
  const clearPassport = useCallback(() => {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage errors
    }
  }, [storageKey])

  /**
   * Initialize passport - load from storage or fetch new
   */
  const initializePassport = useCallback(async () => {
    // Prevent concurrent initialization
    if (isInitializingRef.current) return
    isInitializingRef.current = true

    setLoading('passport', true)
    setError('passport', null)

    try {
      // Check localStorage first
      const stored = loadStoredPassport()
      if (stored && isPassportValid(stored)) {
        setPassport(stored.passport, stored.endUserId)
        setLoading('passport', false)
        return
      }

      // Fetch new passport from API
      const data = await fetchPassport()
      setPassport(data.passport, data.endUserId)
      savePassport({
        passport: data.passport,
        endUserId: data.endUserId,
        expiresAt: data.expiresAt,
      })
    } catch (err) {
      clearPassport()
      setError('passport', (err as Error).message)
    } finally {
      setLoading('passport', false)
      isInitializingRef.current = false
    }
  }, [
    fetchPassport,
    setPassport,
    setLoading,
    setError,
    loadStoredPassport,
    savePassport,
    clearPassport,
    isPassportValid,
  ])

  /**
   * Refresh passport (force fetch new)
   */
  const refreshPassport = useCallback(async () => {
    isInitializingRef.current = false // Allow refresh
    clearPassport()
    await initializePassport()
  }, [clearPassport, initializePassport])

  return {
    passport,
    initializePassport,
    refreshPassport,
    clearPassport,
  }
}
