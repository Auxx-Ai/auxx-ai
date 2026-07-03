// apps/web/src/components/resources/store/calc-value-computer.test.ts
// Store-layer regression tests for the CALC compute pipeline. Covers the
// paths that broke silently before: compute on source arrival (else-branch
// rendering), literal-only formulas with zero source fields, the
// all-sources-already-cached fetch-queue path, and recompute after a config
// change (expression edits showing up without a reload).

import type { CalcOptions } from '@auxx/lib/custom-fields/client'
import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it } from 'vitest'
import { ensureCalcValue, recomputeCalcField } from './calc-value-computer'
import { computedFieldRegistry } from './computed-field-registry'
import { fieldValueFetchQueue } from './field-value-fetch-queue'
import { buildFieldValueKey, toRecordId, useFieldValueStore } from './field-value-store'

const DEF = 'def1'
const RECORD = toRecordId(DEF, 'rec1')
// Bare field UUIDs (no colon), exactly how the calc editor stores sourceFields
const SOURCE_ID = 'srcfld1'
const CALC_ID = 'calcfld1'
const CALC_REF = toResourceFieldId(DEF, CALC_ID)
const SOURCE_KEY = buildFieldValueKey(RECORD, SOURCE_ID)
const CALC_KEY = buildFieldValueKey(RECORD, CALC_ID)

function registerCalc(expression: string, sourceFields: Record<string, string> = {}) {
  computedFieldRegistry.register(CALC_REF, {
    expression,
    sourceFields,
    resultFieldType: 'TEXT',
  } as CalcOptions)
}

function calcValue() {
  return useFieldValueStore.getState().values[CALC_KEY]
}

beforeEach(() => {
  useFieldValueStore.getState().clearAll()
  computedFieldRegistry.clear()
})

describe('compute on source arrival (setValues)', () => {
  it('renders the else branch when eq() does not match', () => {
    registerCalc(`if(eq({${SOURCE_ID}},232),"lalala","noooo")`, { [SOURCE_ID]: SOURCE_ID })

    useFieldValueStore
      .getState()
      .setValues([{ key: SOURCE_KEY, value: { type: 'text', value: '26' } }])

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'noooo' }))
  })

  it('renders the else branch when the source value is null (empty cell)', () => {
    registerCalc(`if({${SOURCE_ID}},"has value","empty")`, { [SOURCE_ID]: SOURCE_ID })

    useFieldValueStore.getState().setValues([{ key: SOURCE_KEY, value: null }])

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'empty' }))
  })
})

describe('ensureCalcValue', () => {
  it('computes a literal-only formula with zero source fields', () => {
    registerCalc('concat("a","b")')

    ensureCalcValue(RECORD, CALC_REF)

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'ab' }))
  })

  it('does not write while a source value is still missing', () => {
    registerCalc(`upper({${SOURCE_ID}})`, { [SOURCE_ID]: SOURCE_ID })

    ensureCalcValue(RECORD, CALC_REF)

    expect(calcValue()).toBeUndefined()
  })
})

describe('fetch queue decomposition with all sources cached', () => {
  it('computes the calc value instead of queueing nothing forever', () => {
    // Source value lands BEFORE the calc field is known — no dependent
    // recompute fired at that point.
    useFieldValueStore
      .getState()
      .setValues([{ key: SOURCE_KEY, value: { type: 'text', value: '26' } }])
    registerCalc(`if(eq({${SOURCE_ID}},232),"lalala","noooo")`, { [SOURCE_ID]: SOURCE_ID })

    // Cell mounts and requests the calc column; every source is already cached.
    const queued = fieldValueFetchQueue.queueFetchBatch([{ recordId: RECORD, fieldRef: CALC_REF }])

    expect(queued).toEqual([])
    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'noooo' }))
  })

  it('computes a zero-source formula on fetch request', () => {
    registerCalc('"hello"')

    fieldValueFetchQueue.queueFetchBatch([{ recordId: RECORD, fieldRef: CALC_REF }])

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'hello' }))
  })
})

describe('recomputeCalcField (config change)', () => {
  it('refreshes stale computed values after an expression edit', () => {
    registerCalc(`if(eq({${SOURCE_ID}},232),"lalala","noooo")`, { [SOURCE_ID]: SOURCE_ID })
    useFieldValueStore
      .getState()
      .setValues([{ key: SOURCE_KEY, value: { type: 'text', value: '26' } }])
    expect(calcValue()).toEqual(expect.objectContaining({ value: 'noooo' }))

    // Formula edited: same source, new literals and matching condition
    registerCalc(`if(eq({${SOURCE_ID}},26),"matched","nope")`, { [SOURCE_ID]: SOURCE_ID })
    recomputeCalcField(CALC_REF)

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'matched' }))
  })

  it('heals a null that a registry-race server fetch backfilled', () => {
    // Calc key was fetched directly (registry not ready) and backfilled null,
    // sources landed too — then the registry syncs.
    useFieldValueStore.getState().setValues([
      { key: SOURCE_KEY, value: { type: 'text', value: '26' } },
      { key: CALC_KEY, value: null },
    ])
    registerCalc(`if(eq({${SOURCE_ID}},232),"lalala","noooo")`, { [SOURCE_ID]: SOURCE_ID })

    recomputeCalcField(CALC_REF)

    expect(calcValue()).toEqual(expect.objectContaining({ type: 'text', value: 'noooo' }))
  })
})
