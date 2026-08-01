// packages/chat/src/transport/realtime-client.ts
//
// One shared Pusher connection per widget instance (keyed by channelId), with
// every channel — the public `chat-{session}` transcript channel and the
// private `thread-{id}` / `visitor-{id}` channels — multiplexed over it. A
// refcounted channel registry collapses duplicate subscriptions (the
// per-visitor channel is needed by both the launcher badge and the open
// conversation) down to a single Pusher channel object.
//
// This deliberately mirrors the admin adapter's design
// (`@auxx/lib/realtime/client`) but is kept small and free of any `@auxx/*`
// dependency so the embeddable bundle stays standalone. The one widget-specific
// piece is auth: a single passport-signed `customHandler`, installed once,
// reading the live passport at call time so token refresh keeps working.

import Pusher, {
  type ChannelAuthorizationCallback,
  type ChannelAuthorizationOptions,
} from 'pusher-js'
import { getApiBase } from '~/shared/runtime-config'
import { clearStoredPassport, getChatPassport } from './passport'

type Handler = (payload: any) => void

interface ChannelEntry {
  channel: ReturnType<Pusher['subscribe']>
  refCount: number
  /** Whether a stale-passport re-auth has already been attempted this cycle. */
  reauthed: boolean
}

/**
 * A per-caller handle on a shared channel. Tracks only this caller's binds so
 * `release()` unbinds exactly them and drops the channel's refcount by one —
 * the underlying Pusher channel is unsubscribed only when the last handle
 * releases.
 */
export interface ChannelHandle {
  bind: (event: string, fn: Handler) => void
  unbind: (event: string, fn: Handler) => void
  /** Idempotent: unbinds this handle's handlers and decrements the refcount. */
  release: () => void
}

export interface SharedClient {
  /** Refcounted subscribe — first caller subscribes, the rest share the channel. */
  channel: (channelName: string) => ChannelHandle
  /** Disconnect the single socket and drop the registry entry (on unmount). */
  destroy: () => void
}

const clients = new Map<string, SharedClient>()

/**
 * Returns the singleton shared client for `channelId`, creating the one Pusher
 * socket (and its passport auth handler) on first call. There is one widget
 * instance per `channelId` on a page, so this is effectively one socket per
 * widget.
 */
export function getRealtimeClient(
  channelId: string,
  config: { key: string; cluster: string; wsHost?: string; wsPort?: number; forceTLS?: boolean }
): SharedClient {
  const existing = clients.get(channelId)
  if (existing) return existing

  // Installed once for the whole connection. Pusher only invokes it for
  // `private-`/`presence-` channels, so the public `chat-{session}` channel
  // rides the same socket without auth. Reads the live passport per call so
  // refresh / 401-retry keep working.
  const channelAuthorization: ChannelAuthorizationOptions = {
    transport: 'ajax',
    endpoint: `${getApiBase()}/api/chat/pusher/auth`,
    customHandler: async (
      { socketId, channelName }: { socketId: string; channelName: string },
      callback: ChannelAuthorizationCallback
    ) => {
      try {
        const { passport } = await getChatPassport(channelId)
        const body = new URLSearchParams({ socket_id: socketId, channel_name: channelName })
        const res = await fetch(`${getApiBase()}/api/chat/pusher/auth`, {
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
        callback(null, json)
      } catch (e) {
        callback(e instanceof Error ? e : new Error(String(e)), null)
      }
    },
  }

  // Self-hosted Sockudo (Pusher-protocol) vs hosted Pusher cloud. The branch is
  // the direct constructor argument so pusher-js contextually types
  // `enabledTransports`. Mirrors the admin adapter's connect branch — kept
  // separate by design (see project notes), not DRYed together.
  const pusher = config.wsHost
    ? new Pusher(config.key, {
        wsHost: config.wsHost,
        wsPort: config.wsPort,
        wssPort: config.wsPort,
        forceTLS: config.forceTLS ?? true,
        enabledTransports: config.forceTLS === false ? ['ws'] : ['ws', 'wss'],
        disableStats: true,
        cluster: '',
        channelAuthorization,
      })
    : new Pusher(config.key, { cluster: config.cluster, forceTLS: true, channelAuthorization })

  const entries = new Map<string, ChannelEntry>()

  // On a private-channel subscription error — commonly an expired/stale passport
  // returning 401 from the auth endpoint — drop the cached passport and force a
  // single fresh re-subscribe. Re-subscribing the same channel name re-runs the
  // auth `customHandler`, which mints a new passport. Guarded to one attempt per
  // channel until a subsequent success resets the flag, so a hard auth failure
  // can't spin. Without this, private channels silently 401 and stop delivering
  // while the public transcript channel keeps working.
  const reauthOnce = (channelName: string) => {
    if (!channelName.startsWith('private-')) return
    const entry = entries.get(channelName)
    if (!entry || entry.reauthed) return
    entry.reauthed = true
    clearStoredPassport(channelId)
    try {
      pusher.subscribe(channelName)
    } catch {
      /* ignore */
    }
  }

  const acquire = (channelName: string): ChannelEntry => {
    let entry = entries.get(channelName)
    if (!entry) {
      const channel = pusher.subscribe(channelName)
      // One debug logger per channel (previously one per caller, which double-
      // logged the shared per-visitor channel).
      channel.bind_global((event: string, payload: unknown) => {
        if (event.startsWith('pusher:')) {
          if (event === 'pusher:subscription_succeeded') {
            console.log('[widget.sub]', channelName, event)
            const e = entries.get(channelName)
            if (e) e.reauthed = false
          } else if (event === 'pusher:subscription_error') {
            console.log('[widget.sub]', channelName, event)
            reauthOnce(channelName)
          }
          return
        }
        console.log('[widget.sub]', channelName, event, payload)
      })
      entry = { channel, refCount: 0, reauthed: false }
      entries.set(channelName, entry)
    }
    entry.refCount += 1
    return entry
  }

  const client: SharedClient = {
    channel(channelName) {
      const entry = acquire(channelName)
      const ownBinds: { event: string; fn: Handler }[] = []
      let released = false
      return {
        bind(event, fn) {
          entry.channel.bind(event, fn)
          ownBinds.push({ event, fn })
        },
        unbind(event, fn) {
          try {
            entry.channel.unbind(event, fn)
          } catch {
            /* ignore */
          }
          const i = ownBinds.findIndex((b) => b.event === event && b.fn === fn)
          if (i >= 0) ownBinds.splice(i, 1)
        },
        release() {
          if (released) return
          released = true
          for (const b of ownBinds) {
            try {
              entry.channel.unbind(b.event, b.fn)
            } catch {
              /* ignore */
            }
          }
          ownBinds.length = 0
          entry.refCount -= 1
          if (entry.refCount <= 0) {
            try {
              entry.channel.unbind_global()
              pusher.unsubscribe(channelName)
            } catch {
              /* ignore */
            }
            entries.delete(channelName)
          }
        },
      }
    },
    destroy() {
      try {
        pusher.disconnect()
      } catch {
        /* ignore */
      }
      entries.clear()
      clients.delete(channelId)
    },
  }

  clients.set(channelId, client)
  return client
}
