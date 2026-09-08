// apps/web/src/app/api/banking/webhook/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

/**
 * The delivery contract of the bank feed's PLATFORM endpoint (plans/bank-connection/06 §3).
 *
 * Pinned because the previous mounting point was unreachable and nothing noticed: the FC cases
 * lived in `applyStripeEvent`, which only a CONNECT endpoint reaches, so four handlers shipped
 * and never once ran. The three behaviours below are the ones an unreachable or over-eager
 * endpoint gets wrong: a bad signature must not retry, an event type this endpoint does not own
 * must not 500, and a real failure must.
 */

const verifyStripeSignature = vi.fn(() => true)
const applyFinancialConnectionsEvent = vi.fn(async () => {})

vi.mock('@auxx/credentials', () => ({
  configService: { get: () => 'whsec_test' },
}))
vi.mock('@auxx/lib/webhooks', () => ({
  verifyStripeSignature: (...args: unknown[]) => verifyStripeSignature(...(args as [])),
}))
vi.mock('@auxx/lib/banking', () => ({
  isFinancialConnectionsEvent: (type: string) => type.startsWith('financial_connections.'),
  applyFinancialConnectionsEvent: (...args: unknown[]) =>
    applyFinancialConnectionsEvent(...(args as [])),
}))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

const URL_BASE = 'https://app.auxx.ai/api/banking/webhook'

const request = (event: unknown, headers: Record<string, string> = { 'stripe-signature': 't=1' }) =>
  new Request(URL_BASE, { method: 'POST', headers, body: JSON.stringify(event) }) as never

const fcEvent = {
  id: 'evt_1',
  type: 'financial_connections.account.disconnected',
  data: { object: { id: 'fca_1' } },
}

beforeEach(() => {
  verifyStripeSignature.mockClear().mockReturnValue(true)
  applyFinancialConnectionsEvent.mockClear().mockResolvedValue(undefined)
})

describe('signature verification', () => {
  it('rejects a request with no stripe-signature header with 400', async () => {
    const response = await POST(request(fcEvent, {}))

    expect(response.status).toBe(400)
    expect(applyFinancialConnectionsEvent).not.toHaveBeenCalled()
  })

  it('rejects a bad signature with 400 so Stripe does not retry an untrusted payload', async () => {
    verifyStripeSignature.mockReturnValue(false)

    const response = await POST(request(fcEvent))

    expect(response.status).toBe(400)
    expect(applyFinancialConnectionsEvent).not.toHaveBeenCalled()
  })
})

describe('dispatch', () => {
  it('hands a Financial Connections event to the feed handler', async () => {
    const response = await POST(request(fcEvent))

    expect(response.status).toBe(200)
    expect(applyFinancialConnectionsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'financial_connections.account.disconnected' })
    )
  })

  it('answers 200 and does nothing for a type this endpoint does not own', async () => {
    // Not an error: a platform endpoint can be sent types it never asked for, and a 500 here
    // would make Stripe redeliver forever and eventually disable the endpoint.
    const response = await POST(request({ id: 'evt_2', type: 'charge.succeeded', data: {} }))

    expect(response.status).toBe(200)
    expect(applyFinancialConnectionsEvent).not.toHaveBeenCalled()
  })

  it('answers 500 on a processing failure so Stripe retries the delivery', async () => {
    applyFinancialConnectionsEvent.mockRejectedValue(new Error('db down'))

    const response = await POST(request(fcEvent))

    expect(response.status).toBe(500)
  })
})
