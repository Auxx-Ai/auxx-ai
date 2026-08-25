// packages/lib/src/field-values/__tests__/currency-integrality-guard.test.ts
//
// The CURRENCY integrality guard on the TYPED write path. The coercion path
// has always rejected fractional amounts, but typed callers skip coercion
// entirely — which is how the BOM cost calculator stored fractional minor
// units (plans/importer/01-current-state.md §4.2). The rule is defined once
// (`assertCurrencyIntegerMinorUnits`, field-value-helpers.ts) and enforced in
// two places these tests pin separately: `buildFieldValueRow` — the last stop
// before a number becomes a `valueNumber` row, covering EVERY writer — and an
// early check in `setValueWithType`, whose only job is ordering: rejecting
// BEFORE the destructive DELETE so existing values survive.

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
import { createFieldValueContext } from '../field-value-helpers'
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

function makeCtx(db: any) {
  const ctx = createFieldValueContext('org-1', undefined, db)
  // Pre-seed so `getField` never reaches the mocked org cache.
  ctx.fieldCache.set(CURRENCY_FIELD.id, CURRENCY_FIELD)
  return ctx
}

describe('buildFieldValueRow — the bottom-most enforcement, every writer passes through it', () => {
  const rowParams = {
    organizationId: 'org-1',
    entityId: 'inst-1',
    entityDefinitionId: 'widget',
    fieldId: 'field-price',
    sortKey: 'a0',
  }

  it('rejects a fractional minor-unit amount for a CURRENCY field', () => {
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
    expect(calls.delete).toBe(1)
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
})
