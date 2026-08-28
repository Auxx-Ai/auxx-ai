// packages/lib/src/postings/__tests__/types.test.ts
//
// The one missing pin in the posting-type vocabulary.
//
// There are three legitimate copies of it, and each earns its keep:
//
//   POSTING_TYPES         `postings/types.ts`                     the CODE contract, client-safe
//   glPostingType         `database/schema/gl-posting.ts`          the STORAGE contract, a pgEnum
//   GlPostingTypeValues   `database/src/enums.ts`                  a GENERATED client-safe mirror
//
// The third is already pinned to the second by exact-set equality in
// `database/src/tests/gl-posting-schema.test.ts`. This file pins the FIRST to
// the third, which closes the chain: `POSTING_TYPES` <-> `GlPostingTypeValues`
// <-> the pgEnum.
//
// Why not assert against the pgEnum directly? `packages/lib`'s vitest setup
// mocks `@auxx/database` — `schema.X` is `{}` there — so the enum's values are
// not readable from this side. `@auxx/database/enums` is a different subpath and
// is NOT mocked, and going through it also respects the dependency tiers: a test
// in `packages/database` importing `@auxx/lib` would invert them.
//
// 🛑 EXACT-set equality, both directions. A subset assertion passes forever and
// would never notice a REMOVAL — and a posting type the code emits but the
// column cannot store is an INSERT that fails at a close, on the one night
// nobody wants to debug an enum.

import { GlPostingTypeValues } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { POSTING_TYPES } from '../types'

describe('the posting-type vocabulary is one vocabulary', () => {
  it('POSTING_TYPES and the GlPostingType storage values hold exactly the same set', () => {
    expect([...POSTING_TYPES].sort()).toEqual([...GlPostingTypeValues].sort())
  })

  it('names no type twice', () => {
    expect(new Set(POSTING_TYPES).size).toBe(POSTING_TYPES.length)
  })

  // The two L3 per-event types the purchasing work added. Carried in the pgEnum
  // from day one because widening a Postgres enum later is a migration and
  // carrying a value nothing writes is free — pinned so that "nothing writes it
  // yet" never becomes a reason to drop them.
  it('carries the L3 per-event types alongside the L1 periodic ones', () => {
    expect(POSTING_TYPES).toContain('receipt')
    expect(POSTING_TYPES).toContain('vendor_bill')
  })
})
