// packages/credentials/src/connections/__tests__/byo-client-variables.test.ts
//
// Regression guard for plans/connections/byo-oauth-client-runtime-gap.md.
//
// The bug these cover: BYO client descriptors are injected at READ time and never stored on
// a ConnectionDefinition, so any server code that derives an allowlist (or a secret-flag set)
// from the raw `connectionVariables` column silently drops `clientId`/`clientSecret` and
// falls back to the platform OAuth client — with no error anywhere.

import { describe, expect, it } from 'vitest'
import {
  BYO_CLIENT_VARS,
  effectiveConnectionVariables,
  splitConnectionVariablesBySecrecy,
} from '../resolve-connection-definition'

const OPEN_OPTIONAL = { requiresOwnClient: false, ownClientOptional: true }
const OPEN_REQUIRED = { requiresOwnClient: true, ownClientOptional: false }
const CLOSED = { requiresOwnClient: false, ownClientOptional: false }

/** Shopify's real shape: one declared variable, no BYO descriptors. */
const undeclaredDef = {
  connectionType: 'oauth2-code',
  connectionVariables: [{ key: 'shop', label: 'Shop subdomain' }],
}

/** The Google app rows' shape: BYO descriptors appended by data migration 039. */
const declaredDef = {
  connectionType: 'oauth2-code',
  connectionVariables: [
    { key: 'clientId', label: 'Client ID', required: false },
    { key: 'clientSecret', label: 'Client Secret', secret: true, required: false },
  ],
}

describe('effectiveConnectionVariables', () => {
  it('injects the BYO client vars for a def that does not declare them', () => {
    const keys = effectiveConnectionVariables(undeclaredDef, OPEN_OPTIONAL).map((v) => v.key)
    expect(keys).toContain('shop')
    expect(keys).toContain('clientId')
    expect(keys).toContain('clientSecret')
  })

  it('does not duplicate them for a def that already declares them', () => {
    const keys = effectiveConnectionVariables(declaredDef, OPEN_OPTIONAL).map((v) => v.key)
    expect(keys.filter((k) => k === 'clientId')).toHaveLength(1)
    expect(keys.filter((k) => k === 'clientSecret')).toHaveLength(1)
  })

  it('marks them required only when the gate demands an own client', () => {
    const optional = effectiveConnectionVariables(undeclaredDef, OPEN_OPTIONAL)
    const required = effectiveConnectionVariables(undeclaredDef, OPEN_REQUIRED)
    expect(optional.find((v) => v.key === 'clientId')?.required).toBe(false)
    expect(required.find((v) => v.key === 'clientId')?.required).toBe(true)
  })

  it('removes them entirely when the gate is closed', () => {
    const keys = effectiveConnectionVariables(undeclaredDef, CLOSED).map((v) => v.key)
    expect(keys).toEqual(['shop'])
  })

  it('leaves non-oauth2-code defs untouched', () => {
    const secretDef = {
      connectionType: 'secret',
      connectionVariables: [{ key: 'apiKey', label: 'API key', secret: true }],
    }
    expect(effectiveConnectionVariables(secretDef, OPEN_OPTIONAL).map((v) => v.key)).toEqual([
      'apiKey',
    ])
  })

  it('tolerates a null connectionVariables column', () => {
    const keys = effectiveConnectionVariables(
      { connectionType: 'oauth2-code', connectionVariables: null },
      OPEN_OPTIONAL
    ).map((v) => v.key)
    expect(keys).toEqual(['clientId', 'clientSecret'])
  })
})

describe('splitConnectionVariablesBySecrecy', () => {
  it('encrypts clientSecret even when the def never declared it', () => {
    const { secretFields, plainVariables } = splitConnectionVariablesBySecrecy(undeclaredDef, {
      shop: 'storage-system',
      clientId: 'public-client-id',
      clientSecret: 'shpss_super_secret',
    })
    expect(secretFields).toEqual({ clientSecret: 'shpss_super_secret' })
    expect(plainVariables).toEqual({ shop: 'storage-system', clientId: 'public-client-id' })
  })

  it('behaves identically for a def that does declare them', () => {
    const { secretFields, plainVariables } = splitConnectionVariablesBySecrecy(declaredDef, {
      clientId: 'public-client-id',
      clientSecret: 'secret',
    })
    expect(secretFields).toEqual({ clientSecret: 'secret' })
    expect(plainVariables).toEqual({ clientId: 'public-client-id' })
  })

  it('still honours a def-declared secret flag on its own variables', () => {
    const def = {
      connectionVariables: [
        { key: 'account', label: 'Account' },
        { key: 'token', label: 'Token', secret: true },
      ],
    }
    const { secretFields, plainVariables } = splitConnectionVariablesBySecrecy(def, {
      account: '123',
      token: 'tok',
    })
    expect(secretFields).toEqual({ token: 'tok' })
    expect(plainVariables).toEqual({ account: '123' })
  })

  it('never routes clientSecret into plaintext metadata for any def shape', () => {
    for (const def of [undeclaredDef, declaredDef, { connectionVariables: null }]) {
      const { plainVariables } = splitConnectionVariablesBySecrecy(def, { clientSecret: 'x' })
      expect(plainVariables).not.toHaveProperty('clientSecret')
    }
  })

  it('keeps the always-secret set aligned with the canonical descriptors', () => {
    // If a BYO descriptor is ever added or its `secret` flag flipped, this catches the drift.
    const declaredSecretKeys = BYO_CLIENT_VARS.filter((v) => v.secret).map((v) => v.key)
    for (const key of declaredSecretKeys) {
      const { secretFields } = splitConnectionVariablesBySecrecy(
        { connectionVariables: [] },
        {
          [key]: 'value',
        }
      )
      expect(secretFields).toHaveProperty(key)
    }
  })
})
