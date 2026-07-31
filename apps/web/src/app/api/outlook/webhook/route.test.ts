// apps/web/src/app/api/outlook/webhook/route.test.ts

import { describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

/**
 * The Microsoft Graph notificationUrl handshake, per
 * https://learn.microsoft.com/graph/change-notifications-delivery — Graph POSTs
 * to the endpoint with `?validationToken=` and an EMPTY body, and requires HTTP
 * 200 + `text/plain` + the URL-decoded token as the whole body within 10s. Miss
 * any of that and the subscription is silently never created.
 *
 * This is pinned because the handler previously answered `validationToken` only
 * on GET: the POST handshake fell through to `await req.json()`, which throws on
 * an empty body, so every create/renew got a 500 and Outlook push stayed dead.
 */

vi.mock('@auxx/database', () => ({ database: {}, schema: {} }))
vi.mock('@auxx/lib/email', () => ({ MessageService: class {} }))
vi.mock('@auxx/lib/webhooks', () => ({ timingSafeStringEqual: () => true }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const URL_BASE = 'https://app.auxx.ai/api/outlook/webhook'

/** Graph's handshake: query param set, body genuinely empty. */
const validationRequest = (rawToken: string) =>
  new Request(`${URL_BASE}?validationToken=${rawToken}`, {
    method: 'POST',
    body: '',
  }) as never

describe('Graph subscription validation handshake', () => {
  it('answers the POST handshake with 200, text/plain and the token', async () => {
    const response = await POST(validationRequest('Validation%3A+Testing'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    await expect(response.text()).resolves.toBe('Validation: Testing')
  })

  it('URL-decodes the token rather than echoing the raw query value', async () => {
    // Graph sends a percent-encoded token and compares against the DECODED form.
    const response = await POST(validationRequest('a%2Bb%20c%26d'))

    await expect(response.text()).resolves.toBe('a+b c&d')
  })

  it('still answers the handshake on GET', async () => {
    const request = new Request(`${URL_BASE}?validationToken=tok`) as never
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/plain')
    await expect(response.text()).resolves.toBe('tok')
  })
})

describe('notification payloads', () => {
  it('rejects an unparseable body with 400, not 500', async () => {
    // 5xx makes Graph retry a payload that can never succeed.
    const request = new Request(URL_BASE, { method: 'POST', body: 'not json' }) as never
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('rejects a well-formed body with no `value` array with 400', async () => {
    const request = new Request(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ nope: true }),
    }) as never
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('acknowledges an empty notification batch with 200', async () => {
    const request = new Request(URL_BASE, {
      method: 'POST',
      body: JSON.stringify({ value: [] }),
    }) as never
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, processed: 0 })
  })
})
