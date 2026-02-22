// ~/hooks/use-pusher.ts (or @auxx/lib/pusher/context.tsx)

import { useQueryClient } from '@tanstack/react-query'
import Pusher, { type Channel } from 'pusher-js'
import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useUser } from '~/hooks/use-user' // Adjust path
import { useEnv } from '~/providers/dehydrated-state-provider'

// Define the shape of the context value
interface PusherContextProps {
  pusher: Pusher | null
  subscribe: (channelName: string) => Channel | null
  unsubscribe: (channelName: string) => void
}

const PusherContext = createContext<PusherContextProps | undefined>(undefined)

interface PusherProviderProps {
  children: ReactNode
}

export const PusherProvider: React.FC<PusherProviderProps> = ({ children }) => {
  // Use useRef to hold the pusher instance to avoid triggering effects when it's set.
  // The state is primarily used to signal the context consumers that the instance is ready.
  const pusherRef = useRef<Pusher | null>(null)
  const [isPusherConnected, setIsPusherConnected] = useState(false) // State for consumers

  const queryClient = useQueryClient()
  const { user, organizationId, isLoading: userLoading } = useUser()
  const { pusher: pusherConfig } = useEnv()
  const PUSHER_APP_KEY = pusherConfig.key || ''
  const PUSHER_CLUSTER = pusherConfig.cluster || 'us3'

  const isAuthenticatedAndReady = !userLoading && !!user && !!organizationId

  useEffect(() => {
    // --- 1. Exit or Cleanup if not ready ---
    if (!isAuthenticatedAndReady) {
      // If not ready but pusher instance exists from a previous state, disconnect it
      if (pusherRef.current) {
        console.log('[PusherProvider] Not authenticated/ready, disconnecting existing Pusher.')
        pusherRef.current.disconnect()
        pusherRef.current = null
        setIsPusherConnected(false) // Update connection status state
      }
      return // Stop here if not ready
    }

    // --- 2. Prevent Re-initialization ---
    // If we reach here, we ARE authenticated and ready.
    // Check if the instance associated with the *current* dependencies already exists.
    // Since dependencies include orgId/userId, changing them triggers cleanup first.
    if (pusherRef.current) {
      console.log('[PusherProvider] Pusher instance already exists for current context.')
      // Optional: Verify connection state if needed: if (pusherRef.current.connection.state !== 'connected') { ... }
      return // Already initialized for this user/org
    }

    // --- 3. Initialize Pusher ---

    if (!PUSHER_APP_KEY) {
      console.error('[PusherProvider] Error: PUSHER_APP_KEY is not configured.')
      return
    }

    // Create the instance and store it in the ref
    const pusherInstance = new Pusher(PUSHER_APP_KEY, {
      cluster: PUSHER_CLUSTER,
      authEndpoint: '/api/pusher/auth',
      auth: {
        /* params if needed */
      },
      forceTLS: true,
    })
    pusherRef.current = pusherInstance // Store instance in ref

    // --- 4. Bind Connection Listeners ---
    const handleConnect = () => {
      setIsPusherConnected(true) // Update state for consumers

      // --- Subscribe and Bind Event Handlers (ONLY after connection) ---
      const orgChannelName = `presence-org-${organizationId}`
      console.log('[PusherProvider] Subscribing to organization channel:', orgChannelName)
      const orgChannel = pusherInstance.subscribe(orgChannelName) // Use pusherInstance

      orgChannel.bind('pusher:subscription_succeeded', () => {
        console.log('[PusherProvider] Subscribed successfully to', orgChannelName)
      })
      orgChannel.bind('pusher:subscription_error', (error: any) => {
        console.error('[PusherProvider] Failed to subscribe to organization channel:', error)
      })

      // --- Event Handlers ---
      const handleNewChatMessage = (data: any) => {
        console.log('[PusherProvider] Event: new-chat-message', data?.threadId)
        queryClient.invalidateQueries({ queryKey: ['threads'] })
        if (data?.threadId) {
          queryClient.invalidateQueries({ queryKey: ['thread', data.threadId] })
        }
      }
      const handleNewSystemMessage = (data: any) => {
        console.log('[PusherProvider] Event: new-system-message', data?.threadId)
        queryClient.invalidateQueries({ queryKey: ['threads'] })
        if (data?.threadId) {
          queryClient.invalidateQueries({ queryKey: ['thread', data.threadId] })
        }
      }
      const handleSessionCreated = (data: any) => {
        console.log('[PusherProvider] Event: session-created', data?.sessionId)
        queryClient.invalidateQueries({ queryKey: ['threads'] })
      }
      const handleSessionClosed = (data: any) => {
        console.log('[PusherProvider] Event: session-closed', data?.threadId)
        queryClient.invalidateQueries({ queryKey: ['threads'] })
        if (data?.threadId) {
          queryClient.invalidateQueries({ queryKey: ['thread', data.threadId] })
        }
      }
      // --- Bind Handlers ---
      orgChannel.bind('new-chat-message', handleNewChatMessage)
      orgChannel.bind('new-system-message', handleNewSystemMessage)
      orgChannel.bind('session-created', handleSessionCreated)
      orgChannel.bind('session-closed', handleSessionClosed)
    }

    const handleError = (err: any) => {
      console.warn('[PusherProvider] Pusher connection error:', err)
      setIsPusherConnected(false)
      // If auth error (e.g., 403), maybe disconnect? Pusher might retry otherwise.
      if (err?.error?.data?.code === 403 || err?.error?.data?.status === 403) {
        pusherRef.current?.disconnect()
        pusherRef.current = null // Clear ref on critical auth error
      }
    }

    const handleDisconnect = () => {
      console.log('[PusherProvider] Pusher disconnected.')
      setIsPusherConnected(false)
      // Don't nullify ref here, Pusher might be reconnecting automatically
    }

    pusherInstance.connection.bind('connected', handleConnect)
    pusherInstance.connection.bind('error', handleError)
    pusherInstance.connection.bind('disconnected', handleDisconnect)

    // --- 5. Cleanup Function ---
    return () => {
      console.log(
        '[PusherProvider] Cleanup: Unbinding connection listeners and disconnecting instance',
        pusherInstance?.connection?.socket_id
      )
      // Use the instance captured in the closure of this effect run
      if (pusherInstance) {
        // Unbind connection listeners first to prevent state updates after cleanup starts
        pusherInstance.connection.unbind('connected', handleConnect)
        pusherInstance.connection.unbind('error', handleError)
        pusherInstance.connection.unbind('disconnected', handleDisconnect)

        // Unsubscribe from all channels associated with this instance
        // (More robust if subscribing to multiple channels)
        Object.keys(pusherInstance.channels.channels).forEach((channelName) => {
          if (channelName.startsWith('presence-org-')) {
            // Be specific if needed
            console.log('[PusherProvider] Cleanup: Unsubscribing from', channelName)
            // Unbind channel listeners before unsubscribing
            pusherInstance.channel(channelName)?.unbind_all()
            pusherInstance.unsubscribe(channelName)
          }
        })

        pusherInstance.disconnect()
        // Only nullify the ref if this specific instance is being cleaned up
        // Check prevents race conditions if dependencies change rapidly
        if (pusherRef.current === pusherInstance) {
          pusherRef.current = null
          setIsPusherConnected(false)
        }
      }
    }
    // --- 6. Final Dependencies ---
    // Rerun ONLY if auth state, org, or user changes. queryClient is stable.
  }, [isAuthenticatedAndReady, organizationId, queryClient]) // Removed 'pusher' state

  // --- Context Methods ---
  const subscribe = (channelName: string): Channel | null => {
    const currentPusher = pusherRef.current // Use ref
    if (!currentPusher) {
      console.warn('[PusherContext] Pusher not initialized, cannot subscribe to', channelName)
      return null
    }
    console.log('[PusherContext] Subscribing to channel:', channelName)
    return currentPusher.subscribe(channelName)
  }

  const unsubscribe = (channelName: string): void => {
    const currentPusher = pusherRef.current // Use ref
    if (!currentPusher) {
      console.warn('[PusherContext] Pusher not initialized, cannot unsubscribe from', channelName)
      return
    }
    console.log('[PusherContext] Unsubscribing from channel:', channelName)
    currentPusher.unsubscribe(channelName)
  }

  // Memoize the context value, now depending on the connection state bool
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe/unsubscribe use pusherRef internally; isPusherConnected triggers re-memoization when instance changes
  const value = useMemo(
    () => ({
      pusher: pusherRef.current, // Provide the current instance from ref
      subscribe,
      unsubscribe,
    }),
    [isPusherConnected]
  ) // Re-memoize when connection status changes (or instance becomes null)

  return <PusherContext.Provider value={value}>{children}</PusherContext.Provider>
}

// Custom hook to consume the context
export const usePusher = (): PusherContextProps => {
  const context = useContext(PusherContext)
  if (context === undefined) {
    throw new Error('usePusher must be used within a PusherProvider')
  }
  return context
}
