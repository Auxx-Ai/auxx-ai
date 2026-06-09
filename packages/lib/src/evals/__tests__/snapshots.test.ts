// packages/lib/src/evals/__tests__/snapshots.test.ts

import { describe, expect, it } from 'vitest'
import { canonicalize, hashSnapshots, stableHash, stripSecrets } from '../snapshots'

describe('canonicalize', () => {
  it('sorts object keys recursively and drops undefined', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 }, e: undefined })).toEqual({
      a: { c: 3, d: 2 },
      b: 1,
    })
  })

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2])
  })
})

describe('stableHash', () => {
  it('is invariant to object key insertion order', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }))
  })

  it('changes when a value changes', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }))
  })

  it('is sensitive to array order', () => {
    expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]))
  })
})

describe('hashSnapshots', () => {
  it('combines both snapshots and is order-stable within each', () => {
    const a = hashSnapshots({ x: 1, y: 2 }, { p: 3 })
    const b = hashSnapshots({ y: 2, x: 1 }, { p: 3 })
    expect(a).toBe(b)
    expect(a).not.toBe(hashSnapshots({ x: 1 }, { p: 3 }))
  })
})

describe('stripSecrets', () => {
  it('redacts secret-shaped keys but keeps reference ids', () => {
    const out = stripSecrets({
      apiKey: 'sk-live-123',
      accessToken: 'tok-abc',
      password: 'hunter2',
      credId: 'cred_42',
      provider: 'shopify',
      nested: { privateKey: 'pk', name: 'keep-me' },
    })
    expect(out).toEqual({
      apiKey: '[redacted]',
      accessToken: '[redacted]',
      password: '[redacted]',
      credId: 'cred_42',
      provider: 'shopify',
      nested: { privateKey: '[redacted]', name: 'keep-me' },
    })
  })
})
