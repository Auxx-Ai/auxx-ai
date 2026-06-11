// packages/credentials/src/store/__tests__/split-sensitive-fields.test.ts

import { describe, expect, it } from 'vitest'
import { splitSensitiveFields } from '../split-sensitive-fields'

describe('splitSensitiveFields', () => {
  it('routes scalar fields by sensitive key name', () => {
    const { secrets, metadata } = splitSensitiveFields({
      accessToken: 'tok',
      apiKey: 'sk-1',
      password: 'p',
      scopes: 'read write',
      accountEmail: 'a@b.com',
      shopDomain: 'shop.myshopify.com',
    })
    expect(secrets).toEqual({ accessToken: 'tok', apiKey: 'sk-1', password: 'p' })
    expect(metadata).toEqual({
      scopes: 'read write',
      accountEmail: 'a@b.com',
      shopDomain: 'shop.myshopify.com',
    })
  })

  it('sends object-valued fields to secrets wholesale (IMAP nested bags)', () => {
    const { secrets, metadata } = splitSensitiveFields({
      provider: 'imap',
      authMode: 'password', // matches the 'auth' pattern → secrets (faithful to legacy)
      imap: { host: 'mail.example.com', user: 'u', password: 'secret1' },
      smtp: { host: 'smtp.example.com', user: 'u', password: 'secret2' },
    })
    // Whole nested objects (which hide passwords under non-sensitive keys) go to secrets.
    expect(secrets).toEqual({
      authMode: 'password',
      imap: { host: 'mail.example.com', user: 'u', password: 'secret1' },
      smtp: { host: 'smtp.example.com', user: 'u', password: 'secret2' },
    })
    // Non-secret scalars that match no pattern remain in plaintext metadata.
    expect(metadata).toEqual({ provider: 'imap' })
  })

  it('treats arrays as scalars (sensitive only by key name)', () => {
    const { secrets, metadata } = splitSensitiveFields({
      scopes: ['read', 'write'],
      secretList: ['a', 'b'],
    })
    expect(metadata).toEqual({ scopes: ['read', 'write'] })
    expect(secrets).toEqual({ secretList: ['a', 'b'] })
  })

  it('matches sensitive patterns case-insensitively and as substrings', () => {
    const { secrets } = splitSensitiveFields({
      RefreshToken: 'r',
      clientSecret: 's',
      privateKey: 'pk',
      passphrase: 'pp',
    })
    expect(Object.keys(secrets).sort()).toEqual([
      'RefreshToken',
      'clientSecret',
      'passphrase',
      'privateKey',
    ])
  })

  it('handles an empty bag', () => {
    expect(splitSensitiveFields({})).toEqual({ secrets: {}, metadata: {} })
  })
})
