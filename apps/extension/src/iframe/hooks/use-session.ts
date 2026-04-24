// apps/extension/src/iframe/hooks/use-session.ts

import { useCallback, useEffect, useState } from 'react'
import { fetchSession, type SessionResponse } from '../trpc'

type SessionState = { status: 'loading' } | { status: 'ready'; session: SessionResponse }

type UseSessionResult = {
  state: SessionState
  /** Re-query `/api/extension/session` (e.g. after org switch or sign-out). */
  refresh: () => Promise<SessionResponse>
  /** Optimistically swap the session without hitting the network. */
  setSession: (session: SessionResponse) => void
}

export function useSession(): UseSessionResult {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchSession().then((session) => {
      if (!cancelled) setState({ status: 'ready', session })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    const session = await fetchSession()
    setState({ status: 'ready', session })
    return session
  }, [])

  const setSession = useCallback((session: SessionResponse) => {
    setState({ status: 'ready', session })
  }, [])

  return { state, refresh, setSession }
}
