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

import {
  GlPostingExportStatusValues,
  GlPostingStatusValues,
  GlPostingTypeValues,
} from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { POSTING_EXPORT_STATUSES, POSTING_STATUSES, POSTING_TYPES } from '../types'

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

describe('the posting-status vocabulary is two vocabularies, held apart', () => {
  // The export split (#2065). One column used to answer both of these, and when
  // they disagreed the ledger lost: a provider refusing a COPY of an entry
  // stamped the row `failed`, and every report counts `['posted','reversed']`,
  // so a real entry left the books. See plans/accounting/export-state-split.md.

  it('POSTING_STATUSES and the GlPostingStatus storage values hold exactly the same set', () => {
    expect([...POSTING_STATUSES].sort()).toEqual([...GlPostingStatusValues].sort())
  })

  it('POSTING_EXPORT_STATUSES and the GlPostingExportStatus storage values match too', () => {
    expect([...POSTING_EXPORT_STATUSES].sort()).toEqual([...GlPostingExportStatusValues].sort())
  })

  // 🛑 The load-bearing pair. A provider's answer must never be representable on
  // the ledger's column, and the ledger's answer must never be representable on
  // the export's - the moment either is, the two can be confused again by
  // exactly the assignment that caused the defect.
  it('gives the ledger no way to say a provider refused something', () => {
    expect(POSTING_STATUSES).not.toContain('failed')
    expect(POSTING_STATUSES).not.toContain('pending')
  })

  it('gives the export no way to say an entry is in the books', () => {
    expect(POSTING_EXPORT_STATUSES).not.toContain('posted')
    expect(POSTING_EXPORT_STATUSES).not.toContain('reversed')
  })

  it('names no status twice', () => {
    expect(new Set(POSTING_STATUSES).size).toBe(POSTING_STATUSES.length)
    expect(new Set(POSTING_EXPORT_STATUSES).size).toBe(POSTING_EXPORT_STATUSES.length)
  })
})
