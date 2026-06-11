// packages/credentials/src/crypto/__tests__/secret-box.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_VALUE } from '../client'
import {
  decryptSecrets,
  decryptValue,
  encryptSecrets,
  encryptValue,
  isMaskEcho,
  isV2Payload,
  maskValue,
} from '../secret-box'

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

describe('encryptValue / decryptValue', () => {
  it('round-trips a string value', () => {
    expect(decryptValue(encryptValue('shpss_abc123'))).toBe('shpss_abc123')
  })

  it('produces a v2 payload', () => {
    expect(isV2Payload(encryptValue('x'))).toBe(true)
  })

  it('passes through plaintext unchanged (lenient policy)', () => {
    expect(decryptValue('plain-client-secret')).toBe('plain-client-secret')
    expect(decryptValue('{client_secret}')).toBe('{client_secret}')
    expect(decryptValue('')).toBe('')
  })

  it('handles null', () => {
    expect(decryptValue(null)).toBeNull()
  })
})

describe('maskValue', () => {
  it('reveals 4+4 for 16+ char secrets', () => {
    expect(maskValue('abcdefghijklmnop')).toBe('abcd********mnop')
  })

  it('reveals 3+3 at 12 chars and 2+2 at 10 chars', () => {
    expect(maskValue('abcdefghijkl')).toBe('abc******jkl')
    expect(maskValue('abcdefghij')).toBe('ab******ij')
  })

  it('returns the fixed full mask under 10 chars', () => {
    for (const len of [0, 1, 5, 8, 9]) {
      expect(maskValue('x'.repeat(len))).toBe('********')
    }
  })

  it('caps the star run at 20', () => {
    const masked = maskValue('a'.repeat(100))
    expect(masked).toBe(`aaaa${'*'.repeat(20)}aaaa`)
  })

  it('always hides at least 6 chars (property)', () => {
    for (let len = 0; len <= 64; len++) {
      const value = Array.from({ length: len }, (_, i) => String.fromCharCode(97 + (i % 26))).join(
        ''
      )
      const masked = maskValue(value)
      // Count revealed original chars: prefix + suffix that match the source value
      let prefix = 0
      while (prefix < masked.length && masked[prefix] !== '*') prefix++
      let suffix = 0
      while (suffix < masked.length && masked[masked.length - 1 - suffix] !== '*') suffix++
      if (masked === '********') {
        expect(value.length).toBeLessThan(10)
      } else {
        expect(value.length - prefix - suffix).toBeGreaterThanOrEqual(6)
        expect(value.startsWith(masked.slice(0, prefix))).toBe(true)
        expect(value.endsWith(masked.slice(masked.length - suffix))).toBe(true)
      }
    }
  })
})

describe('isMaskEcho', () => {
  it('catches the HIDDEN_VALUE sentinel', () => {
    expect(isMaskEcho(HIDDEN_VALUE)).toBe(true)
  })

  it('catches maskValue output across lengths (full mask included)', () => {
    for (const len of [0, 5, 9, 10, 12, 16, 40, 100]) {
      expect(isMaskEcho(maskValue('x'.repeat(len)))).toBe(true)
    }
    expect(isMaskEcho('ab****yz')).toBe(true)
  })

  it('passes real values through', () => {
    expect(isMaskEcho('{client_secret}')).toBe(false)
    expect(isMaskEcho('shpss_real_secret_no_star_runs')).toBe(false)
    expect(isMaskEcho('')).toBe(false)
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
