// packages/lib/src/field-values/__tests__/currency-integrality-guard.test.ts
//
// The CURRENCY at-field-precision guard on the TYPED write path. The coercion
// path has always rejected out-of-precision amounts, but typed callers skip
// coercion entirely, which is how the BOM cost calculator stored fractional
// minor units (plans/importer/01-current-state.md §4.2). The rule is defined
// once (`assertCurrencyAtFieldPrecision`, field-value-helpers.ts) and enforced
// in three places these tests pin separately: `buildFieldValueRow` (the last
// stop before a number becomes a `valueNumber` row, covering EVERY writer),
// an early check in `setValueWithType`, whose only job is ordering: rejecting
// BEFORE the destructive DELETE so existing values survive, and the function
// itself, in isolation.
//
// A field's precision is `options.decimals` (major-unit places). Unset or at
// (or below) the currency's exponent, the field is a whole-minor-unit AMOUNT
// and any fraction is refused: that is the pre-rate-precision behaviour and
// it must not regress. `RATE_DECIMALS` (5 for USD) admits fractional minor
// units: `1.594` is legal, a sixth-place value like `1.5941` still is not.

import { toRecordId } from '@auxx/types/resource'

// ⚠️ Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel (see batched-realtime-publish.test.ts for the import-cycle rationale).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// Large barrel with DB/Redis-backed providers; nothing here is reached because
// the field is pre-seeded into `ctx.fieldCache` and is non-RELATIONSHIP,
// non-unique.
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
}))

import { BadRequestError } from '../../errors'
import { assertCurrencyAtFieldPrecision, createFieldValueContext } from '../field-value-helpers'
import { buildFieldValueRow, setValueWithType } from '../field-value-mutations'

/** Chainable fake db that records whether the destructive DELETE ever ran. */
function makeFakeDb() {
  const calls = { delete: 0 }
  const chain: any = {}
  Object.assign(chain, {
    delete: () => {
      calls.delete++
      return chain
    },
    where: () => chain,
    insert: () => chain,
    values: (rows: any) => {
      chain._pending = Array.isArray(rows) ? rows : [rows]
      return chain
    },
    onConflictDoUpdate: () => chain,
    returning: () =>
      Promise.resolve((chain._pending ?? []).map((row: any) => ({ id: 'fv-1', ...row }))),
    select: () => chain,
    from: () => chain,
    orderBy: () => Promise.resolve([]),
    update: () => chain,
    set: () => chain,
    // The set path wraps its replace in a transaction + advisory lock; run
    // both on the same fake so the delete counter still observes the write.
    transaction: async (fn: (tx: any) => Promise<any>) => fn(chain),
    execute: () => Promise.resolve([]),
  })
  return { db: chain, calls }
}

const recordId = toRecordId('widget', 'inst-1')

const CURRENCY_FIELD = {
  id: 'field-price',
  type: 'CURRENCY',
  options: {},
  entityDefinitionId: null,
  entityDefinition: null,
  entityType: null,
  isUnique: false,
  systemAttribute: null,
} as any

/** A rate field: `options.decimals: 5`, e.g. `part_cost` or `vendor_part_unit_price`. */
const RATE_FIELD = {
  ...CURRENCY_FIELD,
  id: 'field-rate',
  options: { decimals: 5 },
} as any

/** A CURRENCY field explicitly pinned to whole cents: must behave like unset. */
const TWO_PLACE_FIELD = {
  ...CURRENCY_FIELD,
  id: 'field-two-place',
  options: { decimals: 2 },
} as any

function makeCtx(db: any) {
  const ctx = createFieldValueContext('org-1', undefined, db)
  // Pre-seed so `getField` never reaches the mocked org cache.
  ctx.fieldCache.set(CURRENCY_FIELD.id, CURRENCY_FIELD)
  ctx.fieldCache.set(RATE_FIELD.id, RATE_FIELD)
  ctx.fieldCache.set(TWO_PLACE_FIELD.id, TWO_PLACE_FIELD)
  return ctx
}

describe('assertCurrencyAtFieldPrecision: the rule, in isolation', () => {
  it('a 5-place field accepts 1.594', () => {
    expect(() => assertCurrencyAtFieldPrecision(1.594, 5)).not.toThrow()
  })

  it('a 5-place field refuses a sixth place (1.5941)', () => {
    expect(() => assertCurrencyAtFieldPrecision(1.5941, 5)).toThrow(BadRequestError)
  })

  it('a 2-place field refuses 1.594', () => {
    expect(() => assertCurrencyAtFieldPrecision(1.594, 2)).toThrow(BadRequestError)
  })

  it('an unset (undefined) decimals refuses 1.594, same as 2-place', () => {
    expect(() => assertCurrencyAtFieldPrecision(1.594)).toThrow(BadRequestError)
  })

  it('names the field precision in the message', () => {
    expect(() => assertCurrencyAtFieldPrecision(1.5941, 5)).toThrow(/5 decimal places/)
  })
})

describe('buildFieldValueRow — the bottom-most enforcement, every writer passes through it', () => {
  const rowParams = {
    organizationId: 'org-1',
    entityId: 'inst-1',
    entityDefinitionId: 'widget',
    fieldId: 'field-price',
    sortKey: 'a0',
  }

  it('rejects a fractional minor-unit amount for a CURRENCY field with no declared precision', () => {
    expect(() =>
      buildFieldValueRow({
        ...rowParams,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 2148.925 },
      })
    ).toThrow(BadRequestError)
  })

  it('accepts an integer CURRENCY amount', () => {
    const row = buildFieldValueRow({
      ...rowParams,
      fieldType: 'CURRENCY',
      value: { type: 'number', value: 2149 },
    })
    expect(row.valueNumber).toBe(2149)
  })

  it('leaves fractional NUMBER values alone (0.5 m of wire is legal)', () => {
    const row = buildFieldValueRow({
      ...rowParams,
      fieldType: 'NUMBER',
      value: { type: 'number', value: 0.5 },
    })
    expect(row.valueNumber).toBe(0.5)
  })

  it('a rate field (decimals: 5) accepts a fractional minor-unit rate', () => {
    const row = buildFieldValueRow({
      ...rowParams,
      fieldType: 'CURRENCY',
      value: { type: 'number', value: 1.594 },
      currencyOptions: { decimals: 5 },
    })
    expect(row.valueNumber).toBe(1.594)
  })

  it('a rate field (decimals: 5) still refuses a sixth place', () => {
    expect(() =>
      buildFieldValueRow({
        ...rowParams,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 1.5941 },
        currencyOptions: { decimals: 5 },
      })
    ).toThrow(BadRequestError)
  })

  it('a 2-place field still refuses 1.594 (decimals does not widen without opting in)', () => {
    expect(() =>
      buildFieldValueRow({
        ...rowParams,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 1.594 },
        currencyOptions: { decimals: 2 },
      })
    ).toThrow(BadRequestError)
  })
})

describe('setValueWithType — CURRENCY integrality guard', () => {
  it('rejects a fractional minor-unit amount', async () => {
    const { db } = makeFakeDb()
    await expect(
      setValueWithType(makeCtx(db), {
        recordId,
        fieldId: CURRENCY_FIELD.id,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 2148.925 },
      })
    ).rejects.toThrow(BadRequestError)
  })

  it('rejects BEFORE the destructive delete, so existing values survive', async () => {
    const { db, calls } = makeFakeDb()
    await setValueWithType(makeCtx(db), {
      recordId,
      fieldId: CURRENCY_FIELD.id,
      fieldType: 'CURRENCY',
      value: { type: 'number', value: 0.5 },
    }).catch(() => {})
    expect(calls.delete).toBe(0)
  })

  it('accepts an integer amount', async () => {
    const { db, calls } = makeFakeDb()
    const result = await setValueWithType(makeCtx(db), {
      recordId,
      fieldId: CURRENCY_FIELD.id,
      fieldType: 'CURRENCY',
      value: { type: 'number', value: 2149 },
    })
    // No stored rows — the reconcile plans a pure tail insert, no delete.
    expect(calls.delete).toBe(0)
    expect(result).toHaveLength(1)
  })

  it('leaves a clear (null) untouched', async () => {
    const { db } = makeFakeDb()
    await expect(
      setValueWithType(makeCtx(db), {
        recordId,
        fieldId: CURRENCY_FIELD.id,
        fieldType: 'CURRENCY',
        value: null,
      })
    ).resolves.toEqual([])
  })

  it('does not touch non-CURRENCY numbers (a fractional NUMBER is legal)', async () => {
    const { db } = makeFakeDb()
    const numberField = { ...CURRENCY_FIELD, id: 'field-qty', type: 'NUMBER' }
    const ctx = createFieldValueContext('org-1', undefined, db)
    ctx.fieldCache.set(numberField.id, numberField)
    await expect(
      setValueWithType(ctx, {
        recordId,
        fieldId: numberField.id,
        fieldType: 'NUMBER',
        value: { type: 'number', value: 0.5 },
      })
    ).resolves.toHaveLength(1)
  })

  it('a rate field (decimals: 5) accepts a fractional minor-unit rate', async () => {
    const { db, calls } = makeFakeDb()
    const result = await setValueWithType(makeCtx(db), {
      recordId,
      fieldId: RATE_FIELD.id,
      fieldType: 'CURRENCY',
      value: { type: 'number', value: 1.594 },
    })
    expect(calls.delete).toBe(0)
    expect(result).toHaveLength(1)
  })

  it('a rate field (decimals: 5) still refuses a sixth place', async () => {
    const { db } = makeFakeDb()
    await expect(
      setValueWithType(makeCtx(db), {
        recordId,
        fieldId: RATE_FIELD.id,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 1.5941 },
      })
    ).rejects.toThrow(BadRequestError)
  })

  it('a field explicitly pinned to 2 places still refuses 1.594', async () => {
    const { db } = makeFakeDb()
    await expect(
      setValueWithType(makeCtx(db), {
        recordId,
        fieldId: TWO_PLACE_FIELD.id,
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 1.594 },
      })
    ).rejects.toThrow(BadRequestError)
  })
})
