// apps/lambda/src/auth/verify-inbound.ts

/**
 * Inbound request verification for Lambda (Deno runtime).
 *
 * Uses Web Crypto API exclusively — no node:crypto.
 * Mirrors the signing algorithm in @auxx/credentials/lambda-auth/inbound-signing.ts.
 *
 * crypto.subtle.verify() performs constant-time comparison by spec,
 * so we don't need to reimplement timingSafeEqual.
 */

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

interface VerifyResult {
  valid: boolean
  caller?: string
  reason?: string
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return uint8ArrayToHex(new Uint8Array(hash))
}

/**
 * HMAC-SHA256 verification using Web Crypto API.
 */
async function hmacVerify(secret: string, message: string, signatureHex: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const sigBytes = hexToUint8Array(signatureHex)
  const msgBytes = encoder.encode(message)
  return crypto.subtle.verify('HMAC', key, sigBytes as ArrayBufferView<ArrayBuffer>, msgBytes)
}

/**
 * Verify an inbound Lambda invocation request.
 *
 * Checks all required auth headers, timestamp freshness,
 * and HMAC-SHA256 signature validity.
 */
export async function verifyInboundRequest(params: {
  headers: Record<string, string | undefined>
  body: string
  secret: string
}): Promise<VerifyResult> {
  const { headers, body, secret } = params

  const signature = headers['x-auxx-signature']
  const timestamp = headers['x-auxx-timestamp']
  const nonce = headers['x-auxx-nonce']
  const caller = headers['x-auxx-caller']
  const keyId = headers['x-auxx-key-id']

  if (!signature || !timestamp || !nonce || !caller || !keyId) {
    return { valid: false, reason: 'Missing auth headers' }
  }

  // Check timestamp freshness
  const ts = Number(timestamp)
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS) {
    return { valid: false, reason: 'Timestamp out of range' }
  }

  // Strip "sha256=" prefix
  const mac = signature.startsWith('sha256=') ? signature.slice(7) : signature

  // Rebuild canonical message and verify
  const bodySha256 = await sha256Hex(body)
  const canonical = ['v1', timestamp, nonce, caller, keyId, bodySha256].join('\n')
  const message = `inbound:v1:${canonical}`

  const valid = await hmacVerify(secret, message, mac)
  if (!valid) {
    return { valid: false, reason: 'Invalid signature' }
  }

  return { valid: true, caller }
}
