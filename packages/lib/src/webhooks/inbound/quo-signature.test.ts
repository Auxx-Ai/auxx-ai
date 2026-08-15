// packages/lib/src/webhooks/inbound/quo-signature.test.ts
// Golden-vector tests for the Quo (formerly OpenPhone) webhook signature scheme.
//
// Quo signs as `openphone-signature: hmac;1;<timestamp>;<base64 signature>` — HMAC-SHA256,
// base64 digest, over `${timestamp}.${rawBody}`, with the signing key base64-DECODED first.
// Four things differ from what we shipped before (hex digest, utf8 key, no timestamp prefix,
// `x-openphone-signature` header), which is why the channel could never verify a real webhook.
//
// These vectors are the regression guard: they prove the unmodified `verifyHmacSignature`
// primitive covers the scheme (no `HmacVerifyParams` change needed), and they pin the old
// parameters as failing so a revert cannot pass silently.

import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openphonePreset } from './presets'
import { verifyHmacSignature } from './verify'

/** Quo's signing key as it arrives from `POST /v1/webhooks/messages` → `data.key`: base64 of 32 raw bytes. */
const signingKey = randomBytes(32).toString('base64')

/** A realistic `message.received` envelope — `data.object` nesting, `body`, `direction: incoming`. */
const rawBody = JSON.stringify({
  id: 'EVabc123',
  object: 'event',
  apiVersion: 'v3',
  createdAt: '2026-08-14T18:22:11.000Z',
  type: 'message.received',
  data: {
    object: {
      id: 'ACabc123',
      object: 'message',
      from: '+14155550123',
      to: '+18889155797',
      direction: 'incoming',
      body: 'is my order shipped yet?',
      media: [],
      status: 'received',
      createdAt: '2026-08-14T18:22:11.000Z',
      userId: 'USabc123',
      phoneNumberId: 'PN0eLoM7TQ',
      conversationId: 'CNabc123',
    },
  },
})

/** Sign exactly as Quo documents it, and return the full header value. */
function quoHeader(body: string, timestamp: string, key = signingKey): string {
  const signature = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('base64')
  return `hmac;1;${timestamp};${signature}`
}

/** The verify call exactly as the route makes it, given a parsed header. */
function verifyAsRoute(body: string, header: string, secret = signingKey): boolean {
  const [scheme, , timestamp, signature] = header.split(';')
  if (scheme !== 'hmac' || !timestamp || !signature) return false
  return verifyHmacSignature({
    rawBody: body,
    signature,
    secret,
    encoding: 'base64',
    secretEncoding: 'base64',
    signedPayload: () => `${timestamp}.${body}`,
  })
}

describe('quo webhook signature', () => {
  const timestamp = '2026-08-14T18:22:11.000Z'

  it('verifies a signature produced by Quo’s documented algorithm', () => {
    expect(verifyAsRoute(rawBody, quoHeader(rawBody, timestamp))).toBe(true)
  })

  it('accepts an epoch-millisecond timestamp too (the header value is opaque to the HMAC)', () => {
    const epochMs = String(Date.parse(timestamp))
    expect(verifyAsRoute(rawBody, quoHeader(rawBody, epochMs))).toBe(true)
  })

  it('rejects a tampered body', () => {
    const header = quoHeader(rawBody, timestamp)
    const tampered = rawBody.replace('is my order shipped yet?', 'send me a refund')
    expect(tampered).not.toBe(rawBody)
    expect(verifyAsRoute(tampered, header)).toBe(false)
    // Even a single trailing byte must break it — the HMAC is over the raw bytes, never
    // over re-serialized JSON.
    expect(verifyAsRoute(`${rawBody} `, header)).toBe(false)
  })

  it('rejects a swapped timestamp (the timestamp is inside the signed payload)', () => {
    const header = quoHeader(rawBody, timestamp)
    const [, version, , signature] = header.split(';')
    const replayed = `hmac;${version};2026-08-14T19:00:00.000Z;${signature}`
    expect(verifyAsRoute(rawBody, replayed)).toBe(false)
  })

  it('rejects a wrong signing key and a malformed header', () => {
    const header = quoHeader(rawBody, timestamp)
    expect(verifyAsRoute(rawBody, header, randomBytes(32).toString('base64'))).toBe(false)
    expect(verifyAsRoute(rawBody, header, '')).toBe(false)
    // Malformed / unknown-scheme headers never reach the verifier.
    expect(verifyAsRoute(rawBody, 'hmac;1;only-three-parts')).toBe(false)
    expect(verifyAsRoute(rawBody, `sha256;1;${timestamp};abc`)).toBe(false)
    expect(verifyAsRoute(rawBody, '')).toBe(false)
    // A bare digest with no envelope (what a naive provider might send) is rejected too.
    expect(verifyAsRoute(rawBody, header.split(';')[3] ?? '')).toBe(false)
  })

  it('rejects the parameters we shipped before (hex digest, utf8 key, no timestamp prefix)', () => {
    const header = quoHeader(rawBody, timestamp)
    const signature = header.split(';')[3] as string

    // What `openphonePreset` used to declare: hex over the bare raw body with a utf8 key.
    expect(verifyHmacSignature({ rawBody, signature, secret: signingKey, encoding: 'hex' })).toBe(
      false
    )
    // Right encoding, but the key is not base64-decoded.
    expect(
      verifyHmacSignature({
        rawBody,
        signature,
        secret: signingKey,
        encoding: 'base64',
        signedPayload: () => `${timestamp}.${rawBody}`,
      })
    ).toBe(false)
    // Right key handling, but the timestamp prefix is missing from the signed payload.
    expect(
      verifyHmacSignature({
        rawBody,
        signature,
        secret: signingKey,
        encoding: 'base64',
        secretEncoding: 'base64',
      })
    ).toBe(false)
  })
})

describe('openphonePreset', () => {
  it('documents the Quo scheme as data (the route verifies directly)', () => {
    expect(openphonePreset).toEqual({
      scheme: 'hmac',
      header: 'openphone-signature',
      algo: 'sha256',
      encoding: 'base64',
    })
  })
})
