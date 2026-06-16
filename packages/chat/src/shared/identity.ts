// packages/chat/src/shared/identity.ts
//
// Cross-bundle identity-rotation signal. The npm bootstrap (`client/index.ts`)
// and the injected widget bundle (`widget.tsx`) are separate bundles that share
// one `window`. When the visitor's identity rotates (logout / `userJwt` change)
// the bootstrap clears the cached passport, but the already-mounted widget is
// still subscribed to the *previous* identity's private channels. Broadcasting
// a window event lets the widget re-run its identity-scoped subscriptions so
// they re-mint the (now-cleared) passport and resubscribe under the new
// `visitorParticipantId`.

export const IDENTITY_CHANGED_EVENT = 'auxx:identity-changed'

export interface IdentityChangedDetail {
  channelId: string
}

/** Broadcast that the visitor's identity rotated for the given channel. */
export function dispatchIdentityChanged(channelId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<IdentityChangedDetail>(IDENTITY_CHANGED_EVENT, { detail: { channelId } })
  )
}
