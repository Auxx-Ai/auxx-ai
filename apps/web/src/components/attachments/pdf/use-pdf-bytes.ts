// apps/web/src/components/attachments/pdf/use-pdf-bytes.ts

'use client'

import { useEffect, useState } from 'react'

interface PdfBytesState {
  bytes: Uint8Array | null
  error: string | null
  isLoading: boolean
}

/**
 * Fetch a PDF once, into memory.
 *
 * We hand pdf.js bytes rather than the presigned URL for two reasons, both ours:
 *
 * 1. **The ref expires.** `DEFAULT_ASSET_DOWNLOAD_TTL_MS` is 10 minutes and the
 *    S3 presign lasts an hour. If pdf.js held the URL and range-streamed, a page
 *    requested after expiry would 403 mid-document with no recovery path.
 * 2. **Range requests are half-blind anyway.** The private bucket's CORS sets
 *    `exposeHeaders: ['ETag']` only (`infra/storage.ts:81`), so pdf.js cannot
 *    read `Accept-Ranges` or `Content-Length` and falls back to whole-file
 *    fetches regardless.
 *
 * Harmless at the sizes previewed here, a vendor quote is a few hundred KB.
 *
 * The `AbortError` branch matters in dev: `reactStrictMode` is on, so this effect
 * runs twice and the first run's cleanup aborts its own in-flight request. That
 * is not a failure and must not reach the error state.
 */
export function usePdfBytes(url: string | null): PdfBytesState {
  const [state, setState] = useState<PdfBytesState>({
    bytes: null,
    error: null,
    isLoading: Boolean(url),
  })

  useEffect(() => {
    if (!url) {
      setState({ bytes: null, error: null, isLoading: false })
      return
    }

    const controller = new AbortController()
    setState({ bytes: null, error: null, isLoading: true })
    ;(async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Could not download the PDF (${response.status})`)
        }
        const buffer = await response.arrayBuffer()
        setState({ bytes: new Uint8Array(buffer), error: null, isLoading: false })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          bytes: null,
          error: error instanceof Error ? error.message : 'Could not download the PDF',
          isLoading: false,
        })
      }
    })()

    return () => controller.abort()
  }, [url])

  return state
}
