// @auxx/lib/realtime/types.ts

/**
 * Provider-agnostic interface for server-side realtime publishing.
 * Implemented by PusherRealtimeProvider (and potentially others in the future).
 */
export interface RealtimeProvider {
  /** Publish an event to a channel */
  publish(
    channel: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean>

  /** Authenticate a client for a private/presence channel */
  authenticate(
    socketId: string,
    channel: string,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ): { auth: string; channel_data?: string } | null
}
