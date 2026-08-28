// packages/database/src/tests/gl-posting-schema.test.ts
//
// Structural guard for the general-ledger tables (decision G6 —
// plans/money/design/gl-posting-tables.md).
//
// These are not "does Drizzle work" tests. Each one pins a property that, if it
// silently regressed, would reintroduce the exact defect the tables exist to
// fix:
//
//  - the four-column claim index IS the double-post defence. Dropping a column
//    from it (Gap E originally specified three) makes a reversal impossible or
//    a duplicate possible, with no error anywhere.
//  - `GlPostingLine` having no `updatedAt` is what makes its immutability
//    STRUCTURAL. On the entity route `updatable: false` was advisory — read by
//    the grid and by nothing on the write path — and that is precisely what let
//    a posted entry be silently unbalanced.
//  - a positive-only `amountMinor` with `direction` as the sole carrier of sign
//    is decision G2. A signed amount plus a direction lets the two disagree.
//
// The live-database counterpart (the index actually rejecting a concurrent
// duplicate) belongs to the claim path in `packages/lib/src/postings/`.

import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { GlPosting as GlPostingFromBarrel, GlPostingLine } from '../db/schema'
import {
  GlPosting,
  type GlPostingEntity,
  glPostingDirection,
  glPostingStatus,
  glPostingType,
} from '../db/schema/gl-posting'
import type { GlPostingLineEntity } from '../db/schema/gl-posting-line'
import { GlPostingDirectionValues, GlPostingStatusValues, GlPostingTypeValues } from '../enums'

const postingConfig = getTableConfig(GlPosting)
const lineConfig = getTableConfig(GlPostingLine)

const columnNames = (config: ReturnType<typeof getTableConfig>) => config.columns.map((c) => c.name)

describe('GlPosting', () => {
  it('is the table named GlPosting', () => {
    expect(postingConfig.name).toBe('GlPosting')
    // The barrel re-exports one object, not two copies.
    expect(GlPosting).toBe(GlPostingFromBarrel)
  })

  it('carries the four-column claim index, unique', () => {
    const claim = postingConfig.indexes.find(
      (i) => i.config.name === 'GlPosting_org_type_period_revision_key'
    )
    expect(claim, 'the claim index must exist — it IS the double-post defence').toBeDefined()
    expect(claim?.config.unique).toBe(true)
    expect(claim?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'organizationId',
      'postingType',
      'periodKey',
      'revision',
    ])
    // Unconditional: a partial claim index would let an excluded row (a
    // reversed or failed posting) leave the period readable as unclaimed,
    // which is the archived-exclusion leak the entity route already had.
    expect(claim?.config.where).toBeUndefined()
  })

  it('makes a duplicate document number an error rather than a provider surprise', () => {
    const doc = postingConfig.indexes.find((i) => i.config.name === 'GlPosting_org_docNumber_key')
    expect(doc?.config.unique).toBe(true)
    expect(doc?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'organizationId',
      'docNumber',
    ])
  })

  it('maps one provider entry to one posting, only once it has been pushed', () => {
    const provider = postingConfig.indexes.find(
      (i) => i.config.name === 'GlPosting_org_provider_entry_key'
    )
    expect(provider?.config.unique).toBe(true)
    // Partial ON PURPOSE here: `providerEntryId` is NULL until a successful
    // push, and an org with no accounting provider never populates it.
    expect(provider?.config.where).toBeDefined()
  })

  it('holds the amount as bigint minor units, never a float and never int4', () => {
    const total = postingConfig.columns.find((c) => c.name === 'totalMinor')
    // int4 tops out at 2,147,483,647 minor units — $21,474,836.47 — and this
    // org already carries ~$100M in a single account, 4.7x over. Postgres
    // raises 22003 rather than wrapping, so int4's failure mode was a
    // month-end close that simply refuses to post.
    expect(total?.getSQLType()).toBe('bigint')
    expect(total?.notNull).toBe(true)
    // `mode: 'number'` — a JS number, exact to 2^53 minor units (~$90tn).
    // `mode: 'bigint'` would push BigInt plumbing through every pure builder.
    expectTypeOf<GlPostingEntity['totalMinor']>().toEqualTypeOf<number>()
  })

  it('keeps the audit record and the deterministic idempotency key as required columns', () => {
    const names = columnNames(postingConfig)
    expect(names).toContain('draft')
    expect(names).toContain('requestId')
    expect(postingConfig.columns.find((c) => c.name === 'draft')?.notNull).toBe(true)
    expect(postingConfig.columns.find((c) => c.name === 'requestId')?.notNull).toBe(true)
  })

  it('leaves the counters as int4 — only money widened', () => {
    // A guard against a future "widen the amounts" sweep taking the counters
    // with it. `revision` is a reversal ordinal, `attempts` a retry count;
    // neither is money and neither is going anywhere near 2^31.
    expect(postingConfig.columns.find((c) => c.name === 'revision')?.getSQLType()).toBe('integer')
    expect(postingConfig.columns.find((c) => c.name === 'attempts')?.getSQLType()).toBe('integer')
    expect(lineConfig.columns.find((c) => c.name === 'lineNumber')?.getSQLType()).toBe('integer')
  })

  it('carries the row invariants as CHECK constraints', () => {
    const checks = postingConfig.checks.map((c) => c.name)
    expect(checks).toContain('GlPosting_totalMinor_check')
    expect(checks).toContain('GlPosting_revision_check')
    // A reversal must name what it reverses; an original must not.
    expect(checks).toContain('GlPosting_reversal_check')
    expect(checks).toContain('GlPosting_posted_check')
  })

  it('never cascades a delete through a reversal', () => {
    const fk = postingConfig.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'reversesId')
    )
    expect(fk, 'a reversal must point at the entry it reverses').toBeDefined()
    expect(getTableConfig(fk!.reference().foreignTable).name).toBe('GlPosting')
    // An original that has been reversed cannot be deleted out from under its
    // reversal, and deleting one must never take the other with it.
    expect(fk?.onDelete).toBe('restrict')
  })
})

describe('GlPostingLine', () => {
  it('has NO updatedAt — immutability is structural, not advisory', () => {
    expect(columnNames(lineConfig)).not.toContain('updatedAt')
  })

  it('names an account by CODE with no foreign key (decision P2)', () => {
    const code = lineConfig.columns.find((c) => c.name === 'accountCode')
    expect(code?.getSQLType()).toBe('text')
    expect(code?.notNull).toBe(true)
    // The ledger must outlive the chart: an FK to the gl_account EntityInstance
    // would either block deleting a posted-to account or cascade and destroy
    // history. The only FKs on a line are its org and its header.
    const fkTargets = lineConfig.foreignKeys.map(
      (f) => getTableConfig(f.reference().foreignTable).name
    )
    expect(fkTargets.sort()).toEqual(['GlPosting', 'Organization'])
  })

  it('records the role the code was resolved from, without redefining the vocabulary', () => {
    const role = lineConfig.columns.find((c) => c.name === 'accountRole')
    expect(role?.getSQLType()).toBe('text')
    // Nullable and plain text: decision G8's role set is `GlAccountRole` in
    // packages/lib/src/resources/registry/enum-values.ts, and a pgEnum here
    // would be a second copy of it.
    expect(role?.notNull).toBe(false)
  })

  it('snapshots the account name rather than joining for it', () => {
    const name = lineConfig.columns.find((c) => c.name === 'accountName')
    expect(name).toBeDefined()
    expect(name?.notNull).toBe(false)
  })

  it('carries a strictly positive bigint amount with direction as the only sign', () => {
    const amount = lineConfig.columns.find((c) => c.name === 'amountMinor')
    // bigint for the reason on GlPosting.totalMinor; the CHECK keeps it > 0 so
    // `direction` stays the only carrier of sign (decision G2).
    expect(amount?.getSQLType()).toBe('bigint')
    expect(amount?.notNull).toBe(true)
    expectTypeOf<GlPostingLineEntity['amountMinor']>().toEqualTypeOf<number>()
    expect(lineConfig.checks.map((c) => c.name)).toContain('GlPostingLine_amount_check')

    const direction = lineConfig.columns.find((c) => c.name === 'direction')
    expect(direction?.notNull).toBe(true)
    expect(glPostingDirection.enumValues).toEqual(['debit', 'credit'])
  })

  it('keeps the source pair required — the reverse audit read depends on it', () => {
    expect(lineConfig.columns.find((c) => c.name === 'sourceType')?.notNull).toBe(true)
    expect(lineConfig.columns.find((c) => c.name === 'sourceId')?.notNull).toBe(true)
    const sourceIdx = lineConfig.indexes.find(
      (i) => i.config.name === 'GlPostingLine_org_source_idx'
    )
    expect(sourceIdx).toBeDefined()
  })

  it('indexes the trial balance read', () => {
    const tb = lineConfig.indexes.find((i) => i.config.name === 'GlPostingLine_org_accountCode_idx')
    expect(tb?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      'organizationId',
      'accountCode',
    ])
  })

  it('refuses two lines with the same number inside one entry', () => {
    const uniq = lineConfig.indexes.find(
      (i) => i.config.name === 'GlPostingLine_posting_lineNumber_key'
    )
    expect(uniq?.config.unique).toBe(true)
  })
})

describe('the enum vocabularies', () => {
  it('keeps the Drizzle enums and the client-safe value lists in step', () => {
    expect(glPostingType.enumValues).toEqual([...GlPostingTypeValues])
    expect(glPostingStatus.enumValues).toEqual([...GlPostingStatusValues])
    expect(glPostingDirection.enumValues).toEqual([...GlPostingDirectionValues])
  })

  it('carries `reversed` — the terminal state of the ORIGINAL of a reversal pair', () => {
    // The reversal itself is an ordinary `posted` entry (decision G4). Without
    // `reversed` there is no way to see that an entry has been backed out.
    expect(glPostingStatus.enumValues).toContain('reversed')
  })

  it('matches POSTING_TYPES in packages/lib/src/postings/types.ts', () => {
    // Kept literal on purpose: @auxx/database must not import @auxx/lib, so this
    // is the tripwire for the two lists drifting apart.
    expect(glPostingType.enumValues).toEqual([
      'fulfillment',
      'payout',
      'build',
      'month_end_deferral',
      'month_end_reversal',
      'month_end_inventory',
      'receipt',
      'vendor_bill',
    ])
  })
})
