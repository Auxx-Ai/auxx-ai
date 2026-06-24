// packages/credentials/src/crypto/__tests__/secret-mask.test.ts

import { describe, expect, it } from 'vitest'
import {
  HIDDEN_VALUE,
  isMasked,
  type MaskField,
  maskForEdit,
  projectCredentialForEdit,
  resolveForWrite,
  splitConnectionValues,
} from '../client'

const FIELDS: MaskField[] = [
  { key: 'host', secret: false },
  { key: 'apiKey', secret: true },
]

describe('isMasked', () => {
  it('matches the sentinel and mask-shaped strings, not real values', () => {
    expect(isMasked(HIDDEN_VALUE)).toBe(true)
    expect(isMasked('ab****yz')).toBe(true)
    expect(isMasked('')).toBe(false)
    expect(isMasked('shpat_real_value')).toBe(false)
  })
})

describe('maskForEdit', () => {
  it('returns the sentinel for set secrets, real values for plain, and excludes undeclared keys', () => {
    const values = maskForEdit(FIELDS, {
      host: 'db.example.com',
      apiKey: 'super-secret',
      // not declared → must never appear in the projection (reveal protection)
      client_id: 'leak-me',
    })
    expect(values).toEqual({ host: 'db.example.com', apiKey: HIDDEN_VALUE })
    expect('client_id' in values).toBe(false)
  })

  it('emits empty string for an unset secret and a missing plain value', () => {
    expect(maskForEdit(FIELDS, {})).toEqual({ host: '', apiKey: '' })
  })
})

describe('resolveForWrite', () => {
  it('drops a masked secret (kept) and writes a changed one + plain values', () => {
    const { secrets, plain } = resolveForWrite({ host: 'new-host', apiKey: HIDDEN_VALUE }, FIELDS)
    expect(secrets).toEqual({}) // apiKey unchanged → dropped → store merge keeps existing
    expect(plain).toEqual({ host: 'new-host' })

    const changed = resolveForWrite({ host: 'h', apiKey: 'rotated' }, FIELDS)
    expect(changed.secrets).toEqual({ apiKey: 'rotated' })
    expect(changed.plain).toEqual({ host: 'h' })
  })

  it('ignores keys not in the declared field list', () => {
    const { secrets, plain } = resolveForWrite({ rogue: 'x', apiKey: 'k' }, FIELDS)
    expect(secrets).toEqual({ apiKey: 'k' })
    expect(plain).toEqual({})
  })
})

const VARS = [
  { key: 'host', secret: false },
  { key: 'apiKey', secret: true },
]

describe('splitConnectionValues', () => {
  it('splits by the definition flags, dropping a masked secret echo and undeclared keys', () => {
    const { secretFields, plainVariables } = splitConnectionValues(VARS, {
      host: 'new-host',
      apiKey: HIDDEN_VALUE,
      rogue: 'leak',
    })
    expect(secretFields).toEqual({}) // unchanged secret → dropped → store merge keeps existing
    expect(plainVariables).toEqual({ host: 'new-host' })

    const changed = splitConnectionValues(VARS, { host: 'h', apiKey: 'rotated' })
    expect(changed.secretFields).toEqual({ apiKey: 'rotated' })
    expect(changed.plainVariables).toEqual({ host: 'h' })
  })
})

describe('projectCredentialForEdit', () => {
  it('masks set secrets, returns plain values real, and excludes undeclared keys', () => {
    const values = projectCredentialForEdit(VARS, {
      plain: { host: 'db.example.com', rogue: 'leak' },
      secrets: { apiKey: 'super-secret' },
    })
    expect(values).toEqual({ host: 'db.example.com', apiKey: HIDDEN_VALUE })
    expect('rogue' in values).toBe(false)
  })

  it('accepts one merged bag for both plain and secret sources', () => {
    const merged = { host: 'db.example.com', apiKey: 'super-secret' }
    const values = projectCredentialForEdit(VARS, { plain: merged, secrets: merged })
    expect(values).toEqual({ host: 'db.example.com', apiKey: HIDDEN_VALUE })
  })

  it('emits empty string for an unset secret and a missing plain value', () => {
    expect(projectCredentialForEdit(VARS, { plain: {}, secrets: {} })).toEqual({
      host: '',
      apiKey: '',
    })
  })
})
