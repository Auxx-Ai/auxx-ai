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

  useEffect(() => {
    Auxx.boot({ channelId, userJwt, attributes, apiBase, widgetBase, theme })
    bootedRef.current = true
    return () => {
      Auxx.shutdown()
      bootedRef.current = false
    }
    // Reboot whenever the channel / JWT / hosting URLs change. Attribute
    // changes are handled by the second effect via `update()`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, userJwt, apiBase, widgetBase, theme])

  // Serialize attributes so reference-only changes don't fire spurious updates.
  const attributesKey = attributes ? JSON.stringify(attributes) : ''
  useEffect(() => {
    if (!bootedRef.current || !attributes) return
    Auxx.update(attributes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributesKey])

  return null
}

export default AuxxChat
