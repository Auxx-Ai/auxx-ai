// apps/chat-widget/src/transport/pusher.ts

import Pusher from 'pusher-js'
import { getChatPassport } from './passport'

export interface PusherConnection {
  channel: ReturnType<Pusher['subscribe']>
  disconnect: () => void
}

export function connectPusher(opts: {
  key: string
  cluster: string
  channelName: string
}): PusherConnection {
  const pusher = new Pusher(opts.key, {
    cluster: opts.cluster,
    forceTLS: true,
  })
  const channel = pusher.subscribe(opts.channelName)
  channel.bind_global((event: string, payload: unknown) => {
    if (event.startsWith('pusher:')) {
      if (event === 'pusher:subscription_succeeded' || event === 'pusher:subscription_error') {
        console.log('[widget.sub]', opts.channelName, event)
      }
      return
    }
    console.log('[widget.sub]', opts.channelName, event, payload)
  })
  return {
    channel,
    disconnect: () => {
      try {
        pusher.unsubscribe(opts.channelName)
        pusher.disconnect()
      } catch {
        /* ignore */
      }
    },
  }
}

/**
 * Connect to a private Pusher channel. Auth requests are signed by the chat
 * passport — the visitor channel auth endpoint verifies the channel name
 * matches the passport's `visitorParticipantId` claim.
 */
export function connectPrivatePusher(opts: {
  key: string
  cluster: string
  channelName: string
  channelId: string
}): PusherConnection {
  const pusher = new Pusher(opts.key, {
    cluster: opts.cluster,
    forceTLS: true,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: `${__AUXX_API_BASE_URL__}/api/chat/pusher/auth`,
      customHandler: async ({ socketId, channelName }, callback) => {
        try {
          const { passport } = await getChatPassport(opts.channelId)
          const body = new URLSearchParams({ socket_id: socketId, channel_name: channelName })
          const res = await fetch(`${__AUXX_API_BASE_URL__}/api/chat/pusher/auth`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${passport}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            credentials: 'include',
            body: body.toString(),
          })
          if (!res.ok) {
            callback(new Error(`Pusher auth failed (${res.status})`), null)
            return
          }
          const json = (await res.json()) as { auth: string }
          callback(null, json as any)
        } catch (e) {
          callback(e instanceof Error ? e : new Error(String(e)), null)
        }
      },
    },
  })
  const channel = pusher.subscribe(opts.channelName)
  channel.bind_global((event: string, payload: unknown) => {
    if (event.startsWith('pusher:')) {
      if (event === 'pusher:subscription_succeeded' || event === 'pusher:subscription_error') {
        console.log('[widget.sub]', opts.channelName, event)
      }
      return
    }
    console.log('[widget.sub]', opts.channelName, event, payload)
  })
  return {
    channel,
    disconnect: () => {
      try {
        pusher.unsubscribe(opts.channelName)
        pusher.disconnect()
      } catch {
        /* ignore */
      }
    },
  }
}
