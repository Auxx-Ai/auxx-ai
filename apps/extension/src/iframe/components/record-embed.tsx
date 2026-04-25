// apps/extension/src/iframe/components/record-embed.tsx

import { Button } from '@auxx/ui/components/button'
import { ExternalLink } from 'lucide-react'
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
  /** Outer "Open in Auxx" link; the embed itself doesn't render one. */
  openHref: string
  /** Display name for the back-of-card title row above the iframe. */
  displayName: string | null | undefined
}

/**
 * Iframe wrapper that loads `/embed/record/<id>` from auxx.ai. Auth happens
 * once at mount: the extension fetches a short-lived bearer token from
 * `/api/extension/embed-token` (cookies via CORS), then constructs the
 * iframe URL with `?token=...`. The embed page validates the token, sets a
 * partitioned session cookie, and renders the same `PropertyProvider` /
 * `PropertyRow` editing surface the web sidebar uses.
 *
 * Falls back to a plain "Open in Auxx" CTA if the token mint fails — almost
 * always means the user is signed out, which the outer extension shell will
 * pick up on its next session probe.
 */
export function RecordEmbed({ recordId, openHref, displayName }: RecordEmbedProps) {
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
      <div className='flex shrink-0 items-start justify-between gap-2 px-1 pb-2'>
        <h2 className='min-w-0 flex-1 truncate text-sm font-medium'>{displayName ?? 'Untitled'}</h2>
        <Button asChild variant='ghost' size='sm' className='shrink-0 gap-1'>
          <a href={openHref} target='_blank' rel='noreferrer'>
            <ExternalLink className='size-3.5' />
            Open
          </a>
        </Button>
      </div>
      {state === 'minting' && <p className='px-1 text-sm text-muted-foreground'>Loading…</p>}
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
