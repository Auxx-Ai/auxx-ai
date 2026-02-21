import Pusher from 'pusher-js'

let pusherClient: Pusher | null = null

/** Get or create the singleton Pusher client. Caller provides key/cluster from useEnv(). */
export function getPusherClient(pusherKey?: string, pusherCluster?: string) {
  if (!pusherClient && pusherKey && pusherCluster) {
    pusherClient = new Pusher(pusherKey, {
      cluster: pusherCluster,
      forceTLS: true,
      authEndpoint: '/api/pusher/auth',
    })
  }

  return pusherClient
}
