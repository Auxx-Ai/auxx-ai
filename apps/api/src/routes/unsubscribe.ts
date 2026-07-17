// apps/api/src/routes/unsubscribe.ts
// Public `/u/:token` List-Unsubscribe landing page (plans/signals/02-email-engagement.md
// "List-Unsubscribe + one-click"). Handles both the RFC 8058 one-click POST (mail clients
// hit this directly, no page render) and the human GET → confirm → POST flow.
//
// NOT mounted here — the app orchestrator (apps/api/src/index.ts) owns wiring this route
// under `/u`, matching `buildUnsubscribeUrl()` in `@auxx/lib/signals/unsubscribe`.

import { processUnsubscribe, verifyUnsubscribeToken } from '@auxx/lib/signals/unsubscribe'
import { createScopedLogger } from '@auxx/logger'
import { Hono } from 'hono'

const log = createScopedLogger('unsubscribe-route')

const PAGE_STYLES = `
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box;
      background: #f7f7f8; color: #1a1a1a;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #17181a; color: #ededed; }
      .card { background: #232326 !important; border-color: #333 !important; }
      button { background: #ededed !important; color: #17181a !important; }
    }
    .card {
      max-width: 420px; width: 100%; background: #fff; border: 1px solid #e5e5e5;
      border-radius: 12px; padding: 32px; text-align: center;
    }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; line-height: 1.5; color: #666; margin: 0 0 20px; }
    button {
      font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 8px;
      border: none; background: #1a1a1a; color: #fff; cursor: pointer;
    }
  </style>
`

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>${PAGE_STYLES}</head><body><div class="card">${body}</div></body></html>`
}

function expiredPage(): string {
  return page(
    'Link expired',
    '<h1>This link has expired</h1><p>The unsubscribe link you used is no longer valid. If you still want to stop receiving these emails, reply and let us know.</p>'
  )
}

function confirmPage(email: string, token: string): string {
  return page(
    'Unsubscribe',
    `<h1>Unsubscribe ${escapeHtml(email)}?</h1><p>You will stop receiving marketing and automated emails at this address.</p><form method="POST" action="/u/${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`
  )
}

function donePage(email: string): string {
  return page(
    "You're unsubscribed",
    `<h1>You're unsubscribed</h1><p>${escapeHtml(email)} will no longer receive marketing and automated emails from us.</p>`
  )
}

function errorPage(): string {
  return page(
    'Something went wrong',
    '<h1>Something went wrong</h1><p>We could not process your unsubscribe request. Please try again shortly.</p>'
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const unsubscribe = new Hono()

unsubscribe.get('/:token', async (c) => {
  const token = c.req.param('token')
  const verified = await verifyUnsubscribeToken(token)
  // Truthiness check on `.value` (rather than `.ok`) — `TypedResult`'s `ok` getter is typed
  // `boolean`, not a discriminant literal, so it doesn't narrow the union; checking `.value`
  // itself does (an `UnsubscribeTokenPayload` is always truthy, `undefined` is not).
  if (!verified.value) {
    return c.html(expiredPage(), 410)
  }
  return c.html(confirmPage(verified.value.email, token))
})

unsubscribe.post('/:token', async (c) => {
  const token = c.req.param('token')
  const verified = await verifyUnsubscribeToken(token)
  if (!verified.value) {
    return c.html(expiredPage(), 410)
  }
  const payload = verified.value

  // RFC 8058 one-click: mail clients POST this exact body — no form, no browser render.
  // Anything else (our own confirm-page form submit) is a human-initiated 'link' unsub.
  const rawBody = await c.req.text().catch(() => '')
  const isOneClick = rawBody.includes('List-Unsubscribe=One-Click')

  const processed = await processUnsubscribe(payload, {
    source: isOneClick ? 'one_click' : 'link',
  })
  // Same truthiness trick as above — `processed.error` is `Error` on failure, `undefined`
  // (falsy) on success, and narrows correctly where `.ok` would not.
  if (processed.error) {
    log.error('Failed to process unsubscribe', {
      organizationId: payload.organizationId,
      error: processed.error.message,
    })
    if (isOneClick) return c.body(null, 500)
    return c.html(errorPage(), 500)
  }

  if (isOneClick) {
    return c.body(null, 200)
  }
  return c.html(donePage(payload.email))
})

export default unsubscribe
