// apps/chat-widget/src/transport/pusher.ts

import Pusher from 'pusher-js'

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
