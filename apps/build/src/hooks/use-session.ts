// apps/build/src/hooks/use-session.ts

'use client'

import { useEffect, useState } from 'react'
import type { Session } from '~/lib/auth'

/**
 * Client-side hook to access session data
 * Fetches and caches the current user session from the API
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchSession() {
      try {
        const response = await fetch('/api/auth/session')

        if (response.ok) {
          const data = await response.json()
          setSession(data.session)
        } else {
          setSession(null)
        }
      } catch (error) {
        console.error('Failed to fetch session:', error)
        setSession(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSession()
  }, [])

  return { session, isLoading }
}
