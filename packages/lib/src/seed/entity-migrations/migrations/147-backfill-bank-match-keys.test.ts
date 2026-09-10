// packages/lib/src/seed/entity-migrations/migrations/147-backfill-bank-match-keys.test.ts
//
// Migration 147 recomputes every stored `bank_transaction.matchKey` from the row's
// own `description` with the CURRENT `normalizeMatchKey`. What is pinned here:
//
//  - `planRecompute` (pure, no db) decides all four outcomes - unchanged, rewritten
//    (grouped so one UPDATE serves every row landing on the same key), inserted for
//    an instance that never carried a key, and cleared when the new key is empty -
//    and leaves an instance with NO description row alone rather than wiping it;
//  - the plan is expressed against the real normaliser, not a fixture of it, so
//    these cases fail if the two ever drift;
//  - `up()` against a stub `Database` modelled on `143-gl-pointers-hold-ids.test.ts`
//    (fixed rows per table, `.where()` unevaluated) applies the plan and is a no-op
//    on a second run, verified by inspecting the store rather than the log line.

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration147BackfillBankMatchKeys, planRecompute } from './147-backfill-bank-match-keys'

const MIGRATION_ID = '147-backfill-bank-match-keys'
const ORG = 'org_1'

const BANK_TX_DEF = 'def-bank_transaction'
const DESCRIPTION_FIELD = 'field-description'
const MATCH_KEY_FIELD = 'field-match_key'

// The shapes the measured feed is actually made of (task 11's LANDED block).
const SHOPIFY_PAYOUT =
  'SHOPIFY DES:TRANSFER ID:ST-F1K0R8X3L3D5 INDN:LFK ENGINEERING CO ID:XXXXX48598 CCD'
const SHOPIFY_KEY = 'shopify des transfer id st indn lfk engineering co id ccd'

interface Row {
  id: string
  organizationId: string
  fieldId: string
  entityId: string
  valueText: string | null
  entityDefinitionId?: string
  sortKey?: string
}

/**
 * An in-memory `Database`, the same posture as `143-gl-pointers-hold-ids.test.ts`:
 * one row set per TABLE, `.where()` on a select ignored (the schema's column
 * exports carry no usable data in this package's test environment), and an update's
 * id list read back out of the `inArray()` condition it was built with.
 */
function makeStore(seed: {
  entityDefs?: { id: string; organizationId: string; entityType: string }[]
  customFields?: {
    id: string
    organizationId: string
    entityDefinitionId: string
    systemAttribute: string
    options: Record<string, unknown>
  }[]
  fieldValues?: Row[]
}) {
  const state = {
    entityDefs: seed.entityDefs ?? [],
    customFields: seed.customFields ?? [],
    fieldValues: seed.fieldValues ?? [],
  }

  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === schema.EntityDefinition) return state.entityDefs as never
    if (table === schema.CustomField) return state.customFields as never
    if (table === schema.FieldValue) return state.fieldValues as never
    throw new Error('Unknown table in test stub')
  }

  /** The array `inArray(FieldValue.id, ids)` was built with, wherever it sits. */
  const idsFromCondition = (cond: unknown): string[] => {
    const chunks = (cond as { queryChunks?: unknown[] } | null)?.queryChunks
    if (!Array.isArray(chunks)) return []
    if (chunks.length === 5) {
      const op = chunks[2] as { value?: unknown[] } | undefined
      if (Array.isArray(op?.value) && op.value[0] === ' in ' && Array.isArray(chunks[3])) {
        return chunks[3] as string[]
      }
    }
    for (const chunk of chunks) {
      const found = idsFromCondition(chunk)
      if (found.length > 0) return found
    }
    return []
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => ({ where: () => Promise.resolve(rowsFor(table)) }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const ids = idsFromCondition(cond)
          let matched = 0
          for (const row of rowsFor(table)) {
            if (ids.includes(row.id as string)) {
              Object.assign(row, values)
              matched++
            }
          }
          return Promise.resolve({ rowCount: matched })
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>[]) => {
        const target = rowsFor(table)
        values.forEach((value, index) =>
          target.push({ id: `inserted-${target.length + index}`, ...value })
        )
        return Promise.resolve({ rowCount: values.length })
      },
    }),
  }

  return { db: db as never, state }
}

function baseSeed(fieldValues: Row[]) {
  return {
    entityDefs: [{ id: BANK_TX_DEF, organizationId: ORG, entityType: 'bank_transaction' }],
    customFields: [
      {
        id: DESCRIPTION_FIELD,
        organizationId: ORG,
        entityDefinitionId: BANK_TX_DEF,
        systemAttribute: 'bank_transaction_description',
        options: {},
      },
      {
        id: MATCH_KEY_FIELD,
        organizationId: ORG,
        entityDefinitionId: BANK_TX_DEF,
        systemAttribute: 'bank_transaction_match_key',
        options: {},
      },
    ],
    fieldValues,
  }
}

function description(entityId: string, value: string): Row {
  return {
    id: `d-${entityId}`,
    organizationId: ORG,
    fieldId: DESCRIPTION_FIELD,
    entityId,
    valueText: value,
  }
}

function matchKey(entityId: string, value: string | null): Row {
  return {
    id: `k-${entityId}`,
    organizationId: ORG,
    fieldId: MATCH_KEY_FIELD,
    entityId,
    valueText: value,
  }
}

describe('migration 147, planRecompute', () => {
  it('leaves a row whose stored key already matches the current normaliser', () => {
    const plan = planRecompute(
      [description('t1', 'AMAZON WEB SERVICES'), matchKey('t1', 'amazon web services')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.unchanged).toBe(1)
    expect(plan.rewriteGroups.size).toBe(0)
    expect(plan.clearIds).toEqual([])
    expect(plan.inserts).toEqual([])
  })

  it('groups every row landing on one new key into a single UPDATE', () => {
    // The whole point of the change: 68 Shopify payouts that were 68 keys become
    // one, and the write that gets them there is one statement, not 68.
    const rows = [
      description('t1', SHOPIFY_PAYOUT),
      matchKey('t1', 'shopify des transfer id st f1k0r8x3l3d5 indn lfk engineering co id ccd'),
      description(
        't2',
        'SHOPIFY DES:TRANSFER ID:ST-Q7M2W9B4N1H8 INDN:LFK ENGINEERING CO ID:XXXXX48598 CCD'
      ),
      matchKey('t2', 'shopify des transfer id st q7m2w9b4n1h8 indn lfk engineering co id ccd'),
    ]
    const plan = planRecompute(rows, DESCRIPTION_FIELD, MATCH_KEY_FIELD)
    expect(plan.rewriteGroups.size).toBe(1)
    expect(plan.rewriteGroups.get(SHOPIFY_KEY)).toEqual(['k-t1', 'k-t2'])
  })

  it('clears a stored key whose description now normalises to nothing', () => {
    // 🛑 A bare check number. Leaving `check` stored would keep all eleven checks
    // in one group, which is the false-suggestion this fix exists to stop.
    const plan = planRecompute(
      [description('t1', 'Check 1660'), matchKey('t1', 'check')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.clearIds).toEqual(['k-t1'])
    expect(plan.rewriteGroups.size).toBe(0)
  })

  it('treats a stored empty string as already cleared', () => {
    // '' and null are the same answer - "no key" - so this must not count as a write
    // or the migration never reports alreadyUpToDate.
    const plan = planRecompute(
      [description('t1', 'Check 1660'), matchKey('t1', '')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.unchanged).toBe(1)
    expect(plan.clearIds).toEqual([])
  })

  it('inserts a key for an instance that never carried one', () => {
    const plan = planRecompute(
      [description('t1', 'AMAZON WEB SERVICES')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.inserts).toEqual([{ entityId: 't1', matchKey: 'amazon web services' }])
  })

  it('inserts nothing for an instance with no description and no key', () => {
    const plan = planRecompute(
      [description('t1', 'Check 1660')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.inserts).toEqual([])
  })

  it('⚠️ leaves a stored key alone when the instance has NO description row', () => {
    // normalizeMatchKey(null) is '', so recomputing a missing description would wipe
    // the key off every row whose description the feed has not delivered, and the
    // queue would lose their grouping with nothing to say so.
    const plan = planRecompute(
      [matchKey('t1', 'amazon web services')],
      DESCRIPTION_FIELD,
      MATCH_KEY_FIELD
    )
    expect(plan.clearIds).toEqual([])
    expect(plan.rewriteGroups.size).toBe(0)
    expect(plan.unchanged).toBe(0)
  })
})

describe('migration 147, up()', () => {
  it('rewrites, inserts and clears in one pass, then is a no-op on a second run', async () => {
    const { db, state } = makeStore(
      baseSeed([
        // Rewritten: the reference token is gone from the key.
        description('t1', SHOPIFY_PAYOUT),
        matchKey('t1', 'shopify des transfer id st f1k0r8x3l3d5 indn lfk engineering co id ccd'),
        // Cleared: a bare check number is no key at all.
        description('t2', 'Check 1660'),
        matchKey('t2', 'check'),
        // Inserted: no matchKey row existed.
        description('t3', 'AMAZON WEB SERVICES'),
        // Unchanged.
        description('t4', 'HOME DEPOT 442'),
        matchKey('t4', 'home depot 442'),
      ])
    )

    const first = await migration147BackfillBankMatchKeys.up(db, ORG)
    expect(first.alreadyUpToDate).toBe(false)

    const keyOf = (entityId: string) =>
      state.fieldValues.find((r) => r.fieldId === MATCH_KEY_FIELD && r.entityId === entityId)
        ?.valueText

    expect(keyOf('t1')).toBe(SHOPIFY_KEY)
    expect(keyOf('t2')).toBeNull()
    expect(keyOf('t3')).toBe('amazon web services')
    expect(keyOf('t4')).toBe('home depot 442')

    const second = await migration147BackfillBankMatchKeys.up(db, ORG)
    expect(second.alreadyUpToDate).toBe(true)
    expect(state.fieldValues.filter((r) => r.fieldId === MATCH_KEY_FIELD)).toHaveLength(4)
  })

  it('is a no-op on an org that has no bank_transaction def', async () => {
    const { db } = makeStore({ entityDefs: [], customFields: [], fieldValues: [] })
    const result = await migration147BackfillBankMatchKeys.up(db, ORG)
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('creates no defs, fields or relationships', async () => {
    const { db } = makeStore(baseSeed([description('t1', 'AMAZON WEB SERVICES')]))
    const result = await migration147BackfillBankMatchKeys.up(db, ORG)
    expect(result.entityDefsCreated).toBe(0)
    expect(result.fieldsCreated).toBe(0)
    expect(result.relationshipsLinked).toBe(0)
  })
})

describe('migration 147, registration', () => {
  it('is registered exactly once, under its own id', () => {
    const matches = ALL_ENTITY_MIGRATIONS.filter((m) => m.id === MIGRATION_ID)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe(migration147BackfillBankMatchKeys)
  })
})
