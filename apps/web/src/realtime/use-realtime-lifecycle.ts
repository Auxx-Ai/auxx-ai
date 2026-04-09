// ~/realtime/use-realtime-lifecycle.ts

'use client'

import { useEffect } from 'react'
import { useUser } from '~/hooks/use-user'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { realtimeAdapter } from './adapter'

/**
 * Drives the realtime adapter lifecycle based on auth state.
 * Mount once in the app layout. Renders nothing.
 */
export function useRealtimeLifecycle() {
  const { user, organizationId } = useUser()
  const { pusher: config } = useEnv()

  useEffect(() => {
    if (!user || !organizationId) {
      realtimeAdapter.disconnect()
      return
    }

    realtimeAdapter.connect({
      key: config.key,
      cluster: config.cluster,
      authEndpoint: '/api/pusher/auth',
    })

    realtimeAdapter.subscribeToOrg(organizationId)

    return () => {
      realtimeAdapter.disconnect()
    }
  }, [user, organizationId, config.key, config.cluster])
}
