// packages/credentials/src/crypto/__tests__/secret-box.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptSecrets, encryptSecrets, isV2Payload } from '../secret-box'

const V2_KEY = 'a'.repeat(64) // 64 hex chars → 32 bytes

beforeEach(() => {
  vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', V2_KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('encryptSecrets / decryptSecrets round-trip', () => {
  it('round-trips a flat object', () => {
    const obj = { token: 'abc', refresh: 'xyz', count: 3 }
    expect(decryptSecrets(encryptSecrets(obj))).toEqual(obj)
  })

  it('round-trips nested objects', () => {
    const obj = { imap: { host: 'mail.example.com', password: 's3cret' }, port: 993 }
    expect(decryptSecrets(encryptSecrets(obj))).toEqual(obj)
  })

  it('round-trips unicode', () => {
    const obj = { note: 'héllo — 日本語 — 🔐' }
    expect(decryptSecrets(encryptSecrets(obj))).toEqual(obj)
  })

  it('round-trips an empty object', () => {
    expect(decryptSecrets(encryptSecrets({}))).toEqual({})
  })

  it('produces distinct ciphertext for the same input (random IV)', () => {
    const obj = { token: 'abc' }
    expect(encryptSecrets(obj)).not.toBe(encryptSecrets(obj))
  })
})

describe('version prefix', () => {
  it('output starts with v2:', () => {
    expect(encryptSecrets({ a: 1 }).startsWith('v2:')).toBe(true)
  })

  it('isV2Payload distinguishes formats', () => {
    expect(isV2Payload(encryptSecrets({ a: 1 }))).toBe(true)
    expect(isV2Payload('bm90LXYyLXBheWxvYWQ=')).toBe(false)
  })

  it('decryptSecrets rejects a non-prefixed payload', () => {
    expect(() => decryptSecrets('bm90LXYyLXBheWxvYWQ=')).toThrow(
      'Unrecognized credential payload format'
    )
  })
})

describe('tamper detection', () => {
  it('rejects a flipped ciphertext byte', () => {
    const payload = encryptSecrets({ token: 'abc' })
    const raw = Buffer.from(payload.slice('v2:'.length), 'base64')
    raw[raw.length - 1] ^= 0x01 // flip last ciphertext byte
    const tampered = `v2:${raw.toString('base64')}`
    expect(() => decryptSecrets(tampered)).toThrow('Failed to decrypt credential secrets')
  })

  it('rejects a flipped auth-tag byte', () => {
    const payload = encryptSecrets({ token: 'abc' })
    const raw = Buffer.from(payload.slice('v2:'.length), 'base64')
    raw[12] ^= 0x01 // first auth-tag byte (after 12-byte IV)
    const tampered = `v2:${raw.toString('base64')}`
    expect(() => decryptSecrets(tampered)).toThrow('Failed to decrypt credential secrets')
  })
})

describe('key validation', () => {
  it('throws with the generate hint when the key is missing', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '')
    expect(() => encryptSecrets({ a: 1 })).toThrow('openssl rand -hex 32')
  })

  it('throws with the generate hint when the key is malformed', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', 'not-hex-and-too-short')
    expect(() => encryptSecrets({ a: 1 })).toThrow('openssl rand -hex 32')
  })
})
