// apps/web/src/hooks/use-oauth-popup.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Termination-page payload posted via `postMessage` + `BroadcastChannel`. */
interface OAuthDonePayload {
  type: 'oauth_done'
  ok: boolean
  credId?: string | null
  error?: string | null
}

export interface OpenOAuthPopupOptions {
  /** URL to open in the popup window (caller appends `mode=popup`). */
  popupUrl: string
  /** Full-page redirect target used when the popup is blocked. */
  fallbackUrl: string
  /** `BroadcastChannel` name the callback termination page posts on. */
  channelName: string
  /** `window.open` target name (defaults to `auxx-oauth`). */
  windowName?: string
  /** Settled exactly once: `ok` + the connected credId when known. */
  onDone: (ok: boolean, credId?: string | null) => void
  /**
   * Authoritative success backstop, polled every {@link verifyIntervalMs}. Resolve to a credId
   * (or `true`) once the connect is observed server-side; `null`/`false` while still pending.
   * Independent of the popup message channel, so it survives `Cross-Origin-Opener-Policy`
   * severing and the dev NGROK origin split — both of which can drop the `postMessage`/
   * `BroadcastChannel` signal entirely.
   */
  verify?: () => Promise<string | boolean | null>
  /** Verify poll cadence. Default 1500ms. */
  verifyIntervalMs?: number
  /**
   * Grace after the opener regains focus (popup closed/dismissed) before settling as cancelled —
   * a window for a just-completed connect's message/verify to land first. Default 1200ms.
   */
  cancelGraceMs?: number
  /**
   * Hard ceiling before the flow settles as cancelled. A user-cancel is not reliably
   * observable — providers that send `COOP: same-origin` (Stripe, Google, …) sever the
   * browsing-context group, after which `popup.closed` is wrong in both directions — so the
   * timeout is the only safe settlement for cancel. Default 180s.
   */
  timeoutMs?: number
}

/**
 * Shared OAuth-popup lifecycle for connect flows (apps/platform connections and MCP servers).
 *
 * Opens the authorize URL in a popup and settles **exactly once** via, in order of speed:
 * the termination page's `postMessage`/`BroadcastChannel` (instant, but lost under COOP or a
 * cross-origin dev tunnel), an authoritative server-side `verify` poll (the backstop that makes
 * success/cancel detection reliable), or a hard timeout (so an undetectable cancel can't spin
 * forever or leave the caller's UI disabled). It deliberately does **not** rely on `popup.closed`
 * to settle — that signal is unreliable under COOP. Falls back to a full-page redirect when the
 * popup is blocked.
 *
 * `pending` is true from open until settle — bind it to the caller's busy/disabled state.
 */
export function useOAuthPopup() {
  const [pending, setPending] = useState(false)

  // Tear-down for the active listener set (message handler, BroadcastChannel, verify interval,
  // timeout, popup). Set when a flow starts; invoked on settle or unmount.
  const teardownRef = useRef<(() => void) | null>(null)
  const teardown = useCallback(() => {
    teardownRef.current?.()
    teardownRef.current = null
  }, [])
  useEffect(() => () => teardown(), [teardown])

  const open = useCallback(
    ({
      popupUrl,
      fallbackUrl,
      channelName,
      windowName = 'auxx-oauth',
      onDone,
      verify,
      verifyIntervalMs = 1500,
      cancelGraceMs = 1200,
      timeoutMs = 180_000,
    }: OpenOAuthPopupOptions) => {
      const popup = window.open(popupUrl, windowName, 'popup=yes,width=600,height=720')
      if (!popup) {
        // Popup blocked — fall back to a full-page redirect.
        window.location.href = fallbackUrl
        return
      }

      // Replace any prior listener set from an earlier attempt.
      teardown()
      setPending(true)

      let settled = false

      /**
       * Settle exactly once: a toast only on explicit failure (not on cancel/timeout).
       * The popup is closed only on an authoritative settle (callback message / verify success) —
       * the cancel and timeout heuristics can fire while the user is still mid-consent in the
       * popup, and closing it there kills a login the user is actively completing.
       */
      const finish = (
        ok: boolean,
        credId?: string | null,
        error?: string | null,
        opts?: { closePopup?: boolean }
      ) => {
        if (settled) return
        settled = true
        teardown()
        if (opts?.closePopup !== false) {
          try {
            if (!popup.closed) popup.close()
          } catch {
            // COOP-severed popups block the close — the termination page closes itself instead.
          }
        }
        if (!ok && error) {
          toastError({ title: 'Failed to connect', description: error })
        }
        onDone(ok, credId ?? null)
      }

      const handleDone = (payload: OAuthDonePayload) => {
        finish(
          payload.ok,
          payload.credId,
          payload.ok ? undefined : payload.error || 'Connection failed'
        )
      }

      const onMessage = (e: MessageEvent) => {
        if (!e.data || e.data.type !== 'oauth_done') return
        // The callback page may live on a different origin in dev (NGROK_URL tunnel), so also
        // trust messages coming from the popup window we opened ourselves.
        if (e.source !== popup && e.origin !== window.location.origin) return
        handleDone(e.data as OAuthDonePayload)
      }
      window.addEventListener('message', onMessage)

      let bc: BroadcastChannel | null = null
      try {
        bc = new BroadcastChannel(channelName)
        bc.onmessage = (e) => {
          if (!e.data || e.data.type !== 'oauth_done') return
          handleDone(e.data as OAuthDonePayload)
        }
      } catch {
        // BroadcastChannel unavailable — the postMessage path still works.
      }

      // The authoritative poll. Shared by the interval and the cancel-grace re-check.
      const runVerify = async () => {
        if (settled || !verify) return
        try {
          const result = await verify()
          if (result) finish(true, typeof result === 'string' ? result : null)
        } catch {
          // Transient fetch error — the next tick retries.
        }
      }

      const verifyInterval = verify ? setInterval(() => void runVerify(), verifyIntervalMs) : null

      // Best-effort fast cancel: settle as cancelled once the opener regains focus after the popup took
      // it, after a short grace (a window for a just-completed connect's message/verify to land first).
      // We deliberately do NOT read `popup.closed` — providers that send `COOP: same-origin` (Microsoft,
      // Google) block the read (returns a useless `false` and logs a "COOP would block window.closed"
      // warning on every poll). For those providers no client-side signal reliably fires when the user
      // closes the popup on the provider's own page; the guaranteed escape is dismissing the dialog
      // (caller calls `cancel()`), with the hard timeout below as the floor.
      let cancelTimer: ReturnType<typeof setTimeout> | null = null
      const scheduleCancelCheck = () => {
        if (settled || cancelTimer) return
        cancelTimer = setTimeout(async () => {
          cancelTimer = null
          if (settled) return
          // One last authoritative check — the connect may have landed without a message.
          if (verify) {
            try {
              const result = await verify()
              if (result) {
                finish(true, typeof result === 'string' ? result : null)
                return
              }
            } catch {
              // fall through to the cancel decision
            }
            if (settled) return
          }
          // Heuristic cancel — never close the popup here: the focus-return signal can fire while
          // the user is still authenticating in it (macOS focus bounce, a stray click on the
          // opener), and killing the window mid-login is unrecoverable.
          finish(false, null, null, { closePopup: false })
        }, cancelGraceMs)
      }

      // `sawBlur` gates the focus-return (both the watchdog and the focus event) so the initial
      // open — opener still focused, or a stray focus event before the popup ever took focus —
      // isn't read as a return.
      let sawBlur = false
      const watchdog = setInterval(() => {
        if (settled) return
        if (!document.hasFocus()) {
          sawBlur = true
          return
        }
        if (sawBlur) scheduleCancelCheck()
      }, 400)
      const onFocus = () => {
        if (sawBlur) scheduleCancelCheck()
      }
      window.addEventListener('focus', onFocus)

      // Hard ceiling so an undetectable user-cancel doesn't spin forever / leave the UI disabled.
      const giveUpTimer = setTimeout(
        () => finish(false, null, null, { closePopup: false }),
        timeoutMs
      )

      // Teardown never closes the popup — `cancel()` and unmount reach here directly, and both
      // can race a login the user is still completing. `finish` owns the close on an
      // authoritative settle.
      teardownRef.current = () => {
        window.removeEventListener('message', onMessage)
        window.removeEventListener('focus', onFocus)
        clearInterval(watchdog)
        bc?.close()
        if (verifyInterval) clearInterval(verifyInterval)
        if (cancelTimer) clearTimeout(cancelTimer)
        clearTimeout(giveUpTimer)
        setPending(false)
      }
    },
    [teardown]
  )

  // Abort an in-flight popup flow without firing `onDone` — for a guaranteed manual escape (e.g. the
  // caller dismissing its dialog). Tears down listeners/poll/timeout and clears `pending`.
  const cancel = useCallback(() => teardown(), [teardown])

  return { open, pending, cancel }
}
