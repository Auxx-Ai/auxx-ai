// packages/lib/src/data-migrations/migrations/__tests__/155-return-inbound-tracking-multi.test.ts
//
// Migration 155 flips one boolean in one field's options, which makes it the
// smallest migration in this directory and the easiest to get silently wrong.
// What actually goes wrong here:
//
//  - the registry and the migration disagree. The registry edit reaches only
//    NEW orgs and the migration reaches only EXISTING ones, so if the two say
//    different things a fresh org and a migrated org end up with different
//    fields — and nothing fails. Pinned below by asserting the registry
//    literal, not by restating it;
//  - the id reuses a retired number. 001–150 were retired by the one-framework
//    refactor and `buildRegistry` throws on reuse, but only at module load, so
//    a test has to actually import the registry to see it;
//  - 🛑 the 55 lesson: retyping a field produces NO compile error and NO
//    failing test, because field access is untyped at the boundary. So this
//    file deliberately does NOT claim to prove the retype is safe. It pins the
//    declaration and the registration. The worklist is the grep, recorded in
//    the migration's own doc comment.

import { describe, expect, it } from 'vitest'
import { RETURN_FIELDS } from '../../../resources/registry/resources/return-fields'
import { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } from '../../registry'
import { migration155ReturnInboundTrackingMulti } from '../155-return-inbound-tracking-multi'

const MIGRATION_ID = '155-return-inbound-tracking-multi'

describe('migration 155 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is the only migration claiming the number 155', () => {
    const numbers = ALL_DATA_MIGRATIONS.map((m) => m.id.split('-')[0])
    expect(numbers.filter((n) => n === '155')).toHaveLength(1)
  })

  it('carries the id the module exports', () => {
    expect(migration155ReturnInboundTrackingMulti.id).toBe(MIGRATION_ID)
  })

  it('describes what it does, for the ledger', () => {
    expect(migration155ReturnInboundTrackingMulti.description).toMatch(/multi-value/i)
  })
})

describe('the registry says the same thing the migration writes', () => {
  // 🔑 The whole point of this file. A new org is seeded from RETURN_FIELDS and
  // an existing org is reached by the migration. If these two drift, a fresh
  // org gets a multi-value field and a migrated org does not, or the reverse —
  // and every symptom of that shows up months later as "the second tracking
  // number disappeared".
  it('declares inboundTracking multi in the registry', () => {
    expect(RETURN_FIELDS.inboundTracking?.options).toMatchObject({ multi: true })
  })

  it('still points at the attribute the migration matches on', () => {
    expect(RETURN_FIELDS.inboundTracking?.systemAttribute).toBe('return_inbound_tracking')
  })

  it('is still nullable — a return may arrive with no tracking at all', () => {
    // ~15% of returns are an unannounced pallet (57 §4.6). A customer's own
    // label often carries no tracking we can read, and the field must not
    // become required just because it became plural.
    expect(RETURN_FIELDS.inboundTracking?.nullable).toBe(true)
  })

  it('keeps inboundCarrier single-valued', () => {
    // Deliberate asymmetry, and the one thing a reader is most likely to
    // "fix" by mistake. A return's parcels realistically come back by one
    // carrier, and 57 §8.2 rejected the `return_parcel` def that would be
    // needed to bind a carrier to a specific tracking number anyway. Making
    // the carrier plural without that def would create two parallel lists with
    // no relationship between their positions — worse than one of each.
    expect(RETURN_FIELDS.inboundCarrier?.options).not.toMatchObject({ multi: true })
  })
})
