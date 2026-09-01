// packages/lib/src/resources/events/captured-values.test.ts
//
// The unwrappers every hook now routes through. Each case is one of the THREE
// chains in `captured-values.ts`'s table — the point is that one function
// answers correctly for all of them, so no reader has to know which chain fired
// it (`plans/money/tasks/24-captured-value-shape.md`).

import { describe, expect, it } from 'vitest'
import { unwrapRelationId, unwrapRelationIds, unwrapStatusValue } from './captured-values'

const DEF = 'part-def'
const INST = 'part-1'
const RECORD_ID = `${DEF}:${INST}`

describe('unwrapRelationId — one instance id, whatever the chain sent', () => {
  it('unwraps the CAPTURE chain: an array of one RecordId', () => {
    expect(unwrapRelationId([RECORD_ID])).toBe(INST)
  })

  it('unwraps the SYSTEM-HOOK chain: a bare RecordId string', () => {
    expect(unwrapRelationId(RECORD_ID)).toBe(INST)
  })

  it('unwraps the FIELD PRE-HOOK chain: a { type, recordId } envelope', () => {
    expect(unwrapRelationId({ type: 'relationship', recordId: RECORD_ID })).toBe(INST)
    expect(unwrapRelationId([{ type: 'relationship', recordId: RECORD_ID }])).toBe(INST)
  })

  it('passes a bare instance id through — some create paths send no def half', () => {
    expect(unwrapRelationId(INST)).toBe(INST)
    expect(unwrapRelationId([INST])).toBe(INST)
  })

  it('returns undefined for every flavour of absent', () => {
    expect(unwrapRelationId(undefined)).toBeUndefined()
    expect(unwrapRelationId(null)).toBeUndefined()
    expect(unwrapRelationId([])).toBeUndefined()
    expect(unwrapRelationId('')).toBeUndefined()
    expect(unwrapRelationId([''])).toBeUndefined()
  })

  it('takes the first of a to-many relation', () => {
    expect(unwrapRelationId([`${DEF}:a`, `${DEF}:b`])).toBe('a')
  })
})

describe('unwrapRelationIds — every id in a to-many relation', () => {
  it('returns all of them, de-duplicated', () => {
    expect(unwrapRelationIds([`${DEF}:a`, `${DEF}:b`, `${DEF}:a`])).toEqual(['a', 'b'])
  })

  it('handles a single value and the empty cases', () => {
    expect(unwrapRelationIds(RECORD_ID)).toEqual([INST])
    expect(unwrapRelationIds([])).toEqual([])
    expect(unwrapRelationIds(null)).toEqual([])
  })

  it('drops empties rather than emitting undefined holes', () => {
    expect(unwrapRelationIds([`${DEF}:a`, '', null])).toEqual(['a'])
  })
})

describe('unwrapStatusValue — unchanged behaviour after the move', () => {
  it('unwraps the capture chain array, the option envelope and the bare string', () => {
    expect(unwrapStatusValue(['posted'])).toBe('posted')
    expect(unwrapStatusValue({ type: 'option', optionId: 'posted' })).toBe('posted')
    expect(unwrapStatusValue([{ type: 'option', optionId: 'posted' }])).toBe('posted')
    expect(unwrapStatusValue({ value: 'posted' })).toBe('posted')
    expect(unwrapStatusValue('posted')).toBe('posted')
  })

  it('leaves absent values alone', () => {
    expect(unwrapStatusValue(undefined)).toBeUndefined()
    expect(unwrapStatusValue([])).toBeUndefined()
    expect(unwrapStatusValue(null)).toBeNull()
  })
})
