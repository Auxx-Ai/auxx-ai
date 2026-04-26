// apps/extension/src/iframe/components/record-embed.tsx

import Loader from '@auxx/ui/components/loader'
import { useEffect, useRef, useState } from 'react'
import { buildEmbedUrl, type EmbedTheme, fetchEmbedToken } from '../trpc'

/**
 * Read the extension's current theme. The iframe shell sets `dark` on
 * `<html>` based on `prefers-color-scheme` (see `main.tsx`), so checking
 * the class is enough — and it picks up any future toggle that writes the
 * same class.
 */
function readEmbedTheme(): EmbedTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

interface RecordEmbedProps {
  recordId: string
}

/**
 * Iframe wrapper that loads `/embed/record/<id>` from auxx.ai. Auth happens
 * once at mount: the extension fetches a short-lived bearer token from
 * `/api/extension/embed-token` (cookies via CORS), then constructs the
 * iframe URL with `?token=...`. The embed page validates the token, sets a
 * partitioned session cookie, and renders the same `PropertyProvider` /
 * `PropertyRow` editing surface the web sidebar uses — including the
 * identity header + "Open in Auxx" CTA.
 *
 * Surfaces a "Sign in" hint if the token mint fails — almost always means
 * the user is signed out, which the outer extension shell will pick up on
 * its next session probe.
 */
export function RecordEmbed({ recordId }: RecordEmbedProps) {
  const [state, setState] = useState<'minting' | 'ready' | 'error'>('minting')
  const [src, setSrc] = useState<string | null>(null)
  // Re-mint on remount; an old token in memory is worthless once the iframe
  // has been torn down.
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    setState('minting')
    setSrc(null)
    void fetchEmbedToken().then((res) => {
      if (cancelledRef.current) return
      if (!res.ok) {
        setState('error')
        return
      }
      setSrc(buildEmbedUrl(recordId, res.token, readEmbedTheme()))
      setState('ready')
    })
    return () => {
      cancelledRef.current = true
    }
  }, [recordId])

  return (
    <div className='flex h-full flex-col'>
      {state === 'minting' && <Loader size='sm' title='Loading' subtitle='' className='h-full' />}
      {state === 'error' && (
        <p className='px-1 text-sm text-muted-foreground'>Sign in to Auxx to view this record.</p>
      )}
      {state === 'ready' && src && (
        <iframe
          src={src}
          title='Auxx record view'
          className='min-h-0 w-full flex-1 border-0'
          referrerPolicy='no-referrer'
        />
      )}
    </div>
  )
}
