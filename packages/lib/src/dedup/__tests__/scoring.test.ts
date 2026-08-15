// packages/lib/src/dedup/__tests__/scoring.test.ts
//
// Pure — no db. Canonical ordering, signal orientation, bands, group expansion.

import { describe, expect, it } from 'vitest'
import type { BlockMatch } from '../blocking'
import {
  bandForScore,
  scoreBlockGroup,
  scoreIdentityGroup,
  scorePair,
  scoreRecordMatches,
  scoreSignals,
  toCandidatePair,
} from '../scoring'
import type { Signal } from '../types'

const emailSignal = (value: string, otherValue?: string): Signal => ({
  type: 'email',
  strength: 'strong',
  value,
  ...(otherValue ? { otherValue } : {}),
  fieldKey: 'primaryEmail',
})

const scope = { organizationId: 'org_1', entityDefinitionId: 'def_1' }

describe('scoreSignals — distinct evidence, never stacked', () => {
  it('counts a signal TYPE once, however many values matched', () => {
    // Two shared addresses are one fact about the pair. Stacking them would let a
    // multi-value field manufacture confidence out of a single match.
    const one = scoreSignals([emailSignal('a@x.com')])
    const two = scoreSignals([emailSignal('a@x.com'), emailSignal('b@x.com')])
    expect(two).toBe(one)
  })

  it('clamps to 1 when several strong types agree', () => {
    const score = scoreSignals([
      emailSignal('a@x.com'),
      { type: 'phone', strength: 'strong', value: '+14155550100' },
      { type: 'unique', strength: 'strong', value: 'ACME-1' },
    ])
    expect(score).toBe(1)
  })

  it('is zero with no evidence', () => {
    expect(scoreSignals([])).toBe(0)
  })
})

describe('bandForScore — no `low`, so a weak pair is not stored', () => {
  it('bands a strong exact match high', () => {
    expect(bandForScore(0.9)).toBe('high')
  })

  it('bands the medium floor medium', () => {
    expect(bandForScore(0.5)).toBe('medium')
  })

  it('returns null below the floor rather than storing a pair nobody should see', () => {
    expect(bandForScore(0.4)).toBeNull()
    expect(bandForScore(0)).toBeNull()
  })
})

describe('scorePair — phase 1 emits high only', () => {
  it('reaches high on one strong exact key, unaided', () => {
    const scored = scorePair({
      ...scope,
      instanceIdLow: 'a',
      instanceIdHigh: 'b',
      signals: [emailSignal('a@x.com')],
    })
    expect(scored).toMatchObject({ band: 'high' })
    expect(scored?.score).toBeGreaterThanOrEqual(0.9)
  })

  it('drops a pair whose evidence is only corroborating', () => {
    // Corroboration promotes fuzzy evidence; it never suggests on its own.
    const scored = scorePair({
      ...scope,
      instanceIdLow: 'a',
      instanceIdHigh: 'b',
      signals: [
        { type: 'company', strength: 'corroborating', value: 'acme' },
        { type: 'address', strength: 'corroborating', value: '1 Main St' },
      ],
    })
    expect(scored).toBeNull()
  })
})

describe('toCandidatePair — canonical ordering is a storage invariant', () => {
  const match: BlockMatch = { instanceId: 'aaa', signals: [emailSignal('x@y.com')] }

  it('orders low/high by string comparison whichever side was scanned', () => {
    const fromLow = toCandidatePair({
      ...scope,
      instanceId: 'aaa',
      match: { ...match, instanceId: 'zzz' },
    })
    const fromHigh = toCandidatePair({ ...scope, instanceId: 'zzz', match })
    expect(fromLow).toMatchObject({ instanceIdLow: 'aaa', instanceIdHigh: 'zzz' })
    // (A,B) and (B,A) must produce the SAME row — that is what collapses them
    // onto one entry in the review queue instead of showing every duplicate twice.
    expect(fromHigh?.instanceIdLow).toBe(fromLow?.instanceIdLow)
    expect(fromHigh?.instanceIdHigh).toBe(fromLow?.instanceIdHigh)
  })

  it('re-orients an asymmetric signal onto the low/high axis', () => {
    // Blocking emits self-first; storage wants `value` = the LOW record's value.
    const asym: BlockMatch = {
      instanceId: 'aaa',
      signals: [emailSignal('j.ohn+shop@googlemail.com', 'john@gmail.com')],
    }
    const pair = toCandidatePair({ ...scope, instanceId: 'zzz', match: asym })
    expect(pair?.signals[0]).toMatchObject({
      value: 'john@gmail.com',
      otherValue: 'j.ohn+shop@googlemail.com',
    })
  })

  it('leaves an exact (shared-value) signal untouched in either direction', () => {
    const pair = toCandidatePair({ ...scope, instanceId: 'zzz', match })
    expect(pair?.signals[0]).toEqual(emailSignal('x@y.com'))
  })

  it('refuses to pair a record with itself', () => {
    expect(toCandidatePair({ ...scope, instanceId: 'aaa', match })).toBeNull()
  })
})

describe('scoreRecordMatches', () => {
  it('scores every candidate and drops the ones below the floor', () => {
    const scored = scoreRecordMatches({
      ...scope,
      instanceId: 'bbb',
      matches: [
        { instanceId: 'aaa', signals: [emailSignal('a@x.com')] },
        {
          instanceId: 'ccc',
          signals: [{ type: 'company', strength: 'corroborating', value: 'x' }],
        },
      ],
    })
    expect(scored).toHaveLength(1)
    expect(scored[0]).toMatchObject({ instanceIdLow: 'aaa', instanceIdHigh: 'bbb', band: 'high' })
  })
})

describe('group expansion', () => {
  it('turns an org-key bucket into every unordered pair, canonically ordered', () => {
    const scored = scoreBlockGroup({
      ...scope,
      group: {
        value: 'shared@acme.com',
        instanceIds: ['ccc', 'aaa', 'bbb'],
        signal: { type: 'email', strength: 'strong', fieldKey: 'primaryEmail' },
      },
    })
    expect(scored).toHaveLength(3)
    for (const pair of scored) {
      expect(pair.instanceIdLow < pair.instanceIdHigh).toBe(true)
      expect(pair.signals[0]?.value).toBe('shared@acme.com')
    }
  })

  it('names the colliding identity, not just "identity"', () => {
    // "matched on: identity" alone cannot tell a reviewer WHICH external system
    // said these two are the same customer.
    const scored = scoreIdentityGroup({
      ...scope,
      group: {
        source: 'shopify',
        appFieldKey: 'customerId',
        externalId: '99',
        instanceIds: ['aaa', 'bbb'],
      },
    })
    expect(scored).toHaveLength(1)
    expect(scored[0]?.signals[0]).toMatchObject({ type: 'identity', value: 'shopify:99' })
  })

  it('deduplicates ids before expanding', () => {
    const scored = scoreBlockGroup({
      ...scope,
      group: {
        value: 'v',
        instanceIds: ['aaa', 'aaa', 'bbb'],
        signal: { type: 'unique', strength: 'strong', fieldKey: 'accountNumber' },
      },
    })
    expect(scored).toHaveLength(1)
  })
})
