import Pusher from 'pusher-js'
// import { env } from '@auxx/config/server'
// import { env } from '~/env.mjs'

import { env } from '@auxx/config/client'

let pusherClient: Pusher | null = null

export function getPusherClient() {
  if (!pusherClient && env.NEXT_PUBLIC_PUSHER_KEY && env.NEXT_PUBLIC_PUSHER_CLUSTER) {
    pusherClient = new Pusher(env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
      forceTLS: true,
      authEndpoint: '/api/pusher/auth',
    })
  }

  return pusherClient
}
