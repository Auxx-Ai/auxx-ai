// apps/web/src/components/mail/email-editor/floating-compose-root.tsx
'use client'

import { getSequenceManager, useHotkey } from '@tanstack/react-hotkeys'
import { useEffect, useRef } from 'react'
import { useComposeStore } from '../store/compose-store'
import { FloatingCompose } from './floating-compose'

/**
 * Matches the sequence-between-keys timeout used by GlobalCreateRoot's
 * c-prefixed shortcuts (c,c c,o). Compose must defer at least this long
 * so a pending sequence has a chance to complete/time-out before we fire.
 */
const COMPOSE_DEFER_MS = 500

/**
 * Root-level renderer for all floating compose instances.
 * Mount this once at the app layout level so editors persist across navigation.
 *
 * The single-key `C` compose shortcut is a *prefix* of the `c,c` / `c,o` create
 * shortcuts, so we can't fire compose synchronously on keydown — TanStack fires
 * the single-key and sequence listeners independently. Instead we defer compose
 * by COMPOSE_DEFER_MS, and cancel the pending compose if any c-prefixed sequence
 * fires during that window (detected via the sequence manager's triggerCount).
 */
export function FloatingComposeRoot() {
  const instances = useComposeStore((s) => s.instances)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTriggerCountsRef = useRef<Map<string, number>>(new Map())

  // Cancel any pending compose if a c-prefixed sequence fires (e.g. the second
  // key of c,o arrives — that keypress won't re-enter the single-key `C` handler).
  useEffect(() => {
    const manager = getSequenceManager()
    const sub = manager.registrations.subscribe(() => {
      if (!timerRef.current) return
      for (const [id, reg] of manager.registrations.state) {
        const first = reg.sequence[0]
        if (typeof first !== 'string' || first.toUpperCase() !== 'C') continue
        const last = lastTriggerCountsRef.current.get(id) ?? 0
        if (reg.triggerCount > last) {
          clearTimeout(timerRef.current)
          timerRef.current = null
          lastTriggerCountsRef.current.set(id, reg.triggerCount)
          return
        }
      }
    })
    return () => sub.unsubscribe()
  }, [])

  useHotkey(
    'C',
    () => {
      // Wait until after the sequence manager has processed this keydown
      // (both listeners run synchronously on the same event; a microtask gives
      // us the post-event state regardless of listener attachment order).
      queueMicrotask(() => {
        const manager = getSequenceManager()

        // If a c-prefixed sequence JUST fired on this key (triggerCount bumped),
        // suppress compose and don't arm a new timer — the sequence was the user's intent.
        let sequenceJustFired = false
        for (const [id, reg] of manager.registrations.state) {
          const first = reg.sequence[0]
          if (typeof first !== 'string' || first.toUpperCase() !== 'C') continue
          const last = lastTriggerCountsRef.current.get(id) ?? 0
          if (reg.triggerCount > last) sequenceJustFired = true
          lastTriggerCountsRef.current.set(id, reg.triggerCount)
        }

        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null

        if (sequenceJustFired) return

        timerRef.current = setTimeout(() => {
          timerRef.current = null
          useComposeStore.getState().open({ mode: 'new', displayMode: 'floating' })
        }, COMPOSE_DEFER_MS)
      })
    },
    { conflictBehavior: 'allow' }
  )

  if (instances.length === 0) return null

  return (
    <>
      {instances.map((instance) => (
        <FloatingCompose key={instance.id} instance={instance} />
      ))}
    </>
  )
}
