// packages/chat/src/react/index.tsx

/**
 * React wrapper for `@auxx/chat`. Renders nothing — runs `Auxx.boot` in an
 * effect, calls `Auxx.update` when serialized attributes change, and
 * `Auxx.shutdown` on unmount.
 *
 *     <AuxxChat channelId="..." userJwt={token} attributes={{ plan: 'pro' }} />
 *
 * Kept on a sub-path import (`@auxx/chat/react`) so React is not pulled into
 * the non-React bundle.
 */

import { useEffect, useRef } from 'react'
import Auxx, { type BootOptions } from '../client'

export interface AuxxChatProps extends BootOptions {}

export function AuxxChat(props: AuxxChatProps): null {
  const { channelId, userJwt, attributes, apiBase, widgetBase, theme } = props

  // Track whether boot() has run so attribute changes route through update().
  const bootedRef = useRef(false)
  // Track previous userJwt so a defined → undefined transition can route
  // through logout() (clears the cached passport) instead of a full reboot.
  const prevJwtRef = useRef<string | undefined>(userJwt)

  // Boot once per channel/hosting target. JWT changes are handled by the
  // second effect so a simple logout doesn't have to tear down the bundle.
  // biome-ignore lint/correctness/useExhaustiveDependencies: boot is keyed on channel/hosting target only; JWT and attribute changes are handled by sibling effects.
  useEffect(() => {
    Auxx.boot({ channelId, userJwt, attributes, apiBase, widgetBase, theme })
    bootedRef.current = true
    prevJwtRef.current = userJwt
    return () => {
      Auxx.shutdown()
      bootedRef.current = false
    }
  }, [channelId, apiBase, widgetBase, theme])

  // React to JWT changes after boot:
  //  - defined → undefined : logout() (clear cached passport, drop in-memory JWT)
  //  - any change with a defined next value : re-boot to rotate the token
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fires on userJwt only — re-boot reads the latest channelId/hosting props from closure.
  useEffect(() => {
    if (!bootedRef.current) return
    const prev = prevJwtRef.current
    if (prev === userJwt) return
    if (userJwt === undefined) {
      Auxx.logout()
    } else {
      Auxx.boot({ channelId, userJwt, attributes, apiBase, widgetBase, theme })
    }
    prevJwtRef.current = userJwt
  }, [userJwt])

  // Serialize attributes so reference-only changes don't fire spurious updates.
  const attributesKey = attributes ? JSON.stringify(attributes) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: attributesKey is the stable serialized form; attributes is read from closure.
  useEffect(() => {
    if (!bootedRef.current || !attributes) return
    Auxx.update(attributes)
  }, [attributesKey])

  return null
}

export default AuxxChat
