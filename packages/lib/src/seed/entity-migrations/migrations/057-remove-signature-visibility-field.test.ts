// packages/lib/src/seed/entity-migrations/migrations/057-remove-signature-visibility-field.test.ts

import { describe, expect, it } from 'vitest'
import {
  buildDefaultSignatureSettings,
  type DefaultSignatureSeed,
} from './057-remove-signature-visibility-field'

const seed = (over: Partial<DefaultSignatureSeed> = {}): DefaultSignatureSeed => ({
  signatureId: 'sig1',
  ownerId: 'u1',
  ...over,
})

/**
 * Plan 36 §12.2 turns the org-global `signature_is_default` FieldValue into a
 * per-user `UserSetting` pointer. This is the fold: every flagged signature
 * becomes ITS OWNER's `signature.defaultId`, and nobody else's — under
 * `baselineAtCreate: true` the other members cannot see that signature anyway,
 * so inheriting the pointer would only hand the composer an id it will 403 on.
 */
describe('buildDefaultSignatureSettings', () => {
  it('points each resolved owner at their own default signature', () => {
    const { writes, skipped, duplicates } = buildDefaultSignatureSettings([
      seed({ signatureId: 'sigA', ownerId: 'userA' }),
      seed({ signatureId: 'sigB', ownerId: 'userB' }),
    ])
    expect(skipped).toEqual([])
    expect(duplicates).toEqual([])
    expect(writes).toEqual([
      { userId: 'userA', signatureId: 'sigA' },
      { userId: 'userB', signatureId: 'sigB' },
    ])
  })

  it('writes nothing at all when no signature was flagged', () => {
    expect(buildDefaultSignatureSettings([])).toEqual({
      writes: [],
      skipped: [],
      duplicates: [],
    })
  })

  // `UserSetting.userId` is a real FK. An unresolvable owner — no
  // `EntityInstance.createdById` and no user-kind `created_by_id` actor value —
  // must be reported, never written with a fabricated id, or the migration
  // aborts on the FK for the whole org.
  it('skips an unresolvable owner instead of writing a bogus row', () => {
    const orphan = seed({ signatureId: 'sigOrphan', ownerId: null })
    const { writes, skipped, duplicates } = buildDefaultSignatureSettings([orphan])
    expect(writes).toEqual([])
    expect(duplicates).toEqual([])
    expect(skipped).toEqual([orphan])
  })

  it('does not let one orphan suppress its siblings', () => {
    const { writes, skipped } = buildDefaultSignatureSettings([
      seed({ signatureId: 'sigA', ownerId: 'userA' }),
      seed({ signatureId: 'sigOrphan', ownerId: null }),
      seed({ signatureId: 'sigB', ownerId: 'userB' }),
    ])
    expect(writes).toEqual([
      { userId: 'userA', signatureId: 'sigA' },
      { userId: 'userB', signatureId: 'sigB' },
    ])
    expect(skipped.map((s) => s.signatureId)).toEqual(['sigOrphan'])
  })

  it('never emits a write with a null userId', () => {
    const { writes } = buildDefaultSignatureSettings([
      seed({ signatureId: 'sigA', ownerId: null }),
      seed({ signatureId: 'sigB', ownerId: 'userB' }),
    ])
    expect(writes.every((w) => Boolean(w.userId))).toBe(true)
  })

  // Nothing enforced a single `signature_is_default = true` row per org, and dev
  // really did carry three in one org. The per-user pointer holds exactly one
  // id, so the extras have to be reported rather than silently overwriting the
  // first — "this member had three defaults" must be findable in the log.
  it('keeps the first default per owner and reports the rest', () => {
    const { writes, duplicates, skipped } = buildDefaultSignatureSettings([
      seed({ signatureId: 'sig1', ownerId: 'userA' }),
      seed({ signatureId: 'sig2', ownerId: 'userA' }),
      seed({ signatureId: 'sig3', ownerId: 'userA' }),
    ])
    expect(skipped).toEqual([])
    expect(writes).toEqual([{ userId: 'userA', signatureId: 'sig1' }])
    expect(duplicates.map((d) => d.signatureId)).toEqual(['sig2', 'sig3'])
  })

  it('treats each owner separately when several own duplicates', () => {
    const { writes, duplicates } = buildDefaultSignatureSettings([
      seed({ signatureId: 'a1', ownerId: 'userA' }),
      seed({ signatureId: 'b1', ownerId: 'userB' }),
      seed({ signatureId: 'a2', ownerId: 'userA' }),
      seed({ signatureId: 'b2', ownerId: 'userB' }),
    ])
    expect(writes).toEqual([
      { userId: 'userA', signatureId: 'a1' },
      { userId: 'userB', signatureId: 'b1' },
    ])
    expect(duplicates.map((d) => d.signatureId)).toEqual(['a2', 'b2'])
  })

  // The caller sorts the flagged ids before folding, so the winner is stable
  // across runs and environments rather than planner-dependent.
  it('is deterministic — the same input always names the same winner', () => {
    const seeds = [
      seed({ signatureId: 'sig1', ownerId: 'userA' }),
      seed({ signatureId: 'sig2', ownerId: 'userA' }),
    ]
    expect(buildDefaultSignatureSettings(seeds)).toEqual(buildDefaultSignatureSettings(seeds))
  })

  it('partitions every input into exactly one bucket', () => {
    const seeds = [
      seed({ signatureId: 'a1', ownerId: 'userA' }),
      seed({ signatureId: 'a2', ownerId: 'userA' }),
      seed({ signatureId: 'orphan', ownerId: null }),
      seed({ signatureId: 'b1', ownerId: 'userB' }),
    ]
    const { writes, skipped, duplicates } = buildDefaultSignatureSettings(seeds)
    expect(writes.length + skipped.length + duplicates.length).toBe(seeds.length)
  })
})
