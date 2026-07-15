// packages/lib/src/field-values/resolvers/visit-virtual-fields.test.ts

import { describe, expect, it } from 'vitest'
import type { FieldValueContext } from '../field-value-helpers'
import { resolveVisitVirtualFields } from './visit-virtual-fields'

/** Build the minimal query-chain double needed by the Visit virtual resolver. */
function createDatabase(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  }
}

/** Build the field-value context needed by the Visit virtual resolver. */
function createContext(rows: unknown[]): FieldValueContext {
  return {
    db: createDatabase(rows) as unknown as FieldValueContext['db'],
    organizationId: 'org_123',
    fieldCache: new Map(),
    batchRelationshipValidationCache: new Map(),
    validator: {} as FieldValueContext['validator'],
    bypassFieldGuards: new Set(),
  }
}

describe('resolveVisitVirtualFields', () => {
  it('returns raw typed timestamps without presentation metadata', async () => {
    const startTime = new Date('2026-07-14T16:30:00.000Z')
    const endTime = new Date('2026-07-14T17:30:00.000Z')
    const values = await resolveVisitVirtualFields(
      createContext([{ id: 'visit_123', startTime, endTime }]),
      ['visit_123'],
      ['date', 'startTime', 'endTime'],
      new Map([
        ['date', 'date-field'],
        ['startTime', 'start-field'],
        ['endTime', 'end-field'],
      ])
    )

    const fields = values.get('visit_123')
    expect(fields?.get('date')).toMatchObject({
      value: { type: 'date', value: startTime.toISOString() },
    })
    expect(fields?.get('startTime')).toMatchObject({
      value: { type: 'date', value: startTime.toISOString() },
    })
    expect(fields?.get('endTime')).toMatchObject({
      value: { type: 'date', value: endTime.toISOString() },
    })
    expect(fields?.get('date')?.fieldOptions).toBeUndefined()
    expect(fields?.get('startTime')?.fieldOptions).toBeUndefined()
    expect(fields?.get('endTime')?.fieldOptions).toBeUndefined()
  })

  it('omits absent Visit times', async () => {
    const startTime = new Date('2026-07-14T16:30:00.000Z')
    const values = await resolveVisitVirtualFields(
      createContext([{ id: 'visit_123', startTime, endTime: null }]),
      ['visit_123'],
      ['date', 'startTime', 'endTime'],
      new Map()
    )

    const fields = values.get('visit_123')
    expect(fields?.get('date')?.value).toMatchObject({
      type: 'date',
      value: startTime.toISOString(),
    })
    expect(fields?.get('startTime')?.value).toMatchObject({
      type: 'date',
      value: startTime.toISOString(),
    })
    expect(fields?.has('endTime')).toBe(false)
  })
})
