// apps/web/src/app/ph/[[...path]]/route.ts

import type { NextRequest } from 'next/server'

const POSTHOG_INGEST = 'https://us.i.posthog.com'
const POSTHOG_ASSETS = 'https://us-assets.i.posthog.com'

async function handler(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/^\/ph/, '')
  const search = request.nextUrl.search

  const isAsset = path.startsWith('/static/')
  const origin = isAsset ? POSTHOG_ASSETS : POSTHOG_INGEST
  const destinationUrl = `${origin}${path}${search}`

  const headers = new Headers(request.headers)
  headers.set('host', new URL(origin).host)
  headers.delete('connection')

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.blob()

  const response = await fetch(destinationUrl, {
    method: request.method,
    headers,
    body,
  })

  // Fully consume the response to avoid truncation from content-encoding mismatches
  const data = await response.arrayBuffer()
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  responseHeaders.delete('transfer-encoding')

  return new Response(data, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = handler
export const POST = handler
