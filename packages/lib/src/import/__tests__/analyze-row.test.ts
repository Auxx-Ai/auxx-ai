// packages/lib/src/import/__tests__/analyze-row.test.ts

import { describe, expect, it } from 'vitest'
import { hashValue } from '../hashing/hash-value'
import { analyzeRow } from '../planning/analyze-row'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'

function mapping(overrides: Partial<ImportMappingProperty>): ImportMappingProperty {
  return {
    id: 'prop-1',
    importMappingId: 'mapping-1',
    sourceColumnIndex: 0,
    sourceColumnName: 'Email',
    targetType: 'particle',
    targetFieldKey: 'primary_email',
    customFieldId: null,
    resolutionType: 'email:split',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function resolution(rawValue: string, resolved: ValueResolution['resolvedValues'][number]) {
  const res: ValueResolution = {
    id: 'res-1',
    importJobPropertyId: 'jobprop-1',
    hashedValue: hashValue(rawValue),
    rawValue,
    cellCount: 1,
    resolvedValues: [resolved],
    isValid: resolved.type !== 'error',
  }
  return res
}

describe('analyzeRow — multi-value identifier (match-ANY)', () => {
  const baseCtx = {
    mappings: [mapping({})],
    identifierFieldKey: 'primary_email',
  }

  it('matches ANY element and plans an update when exactly one record matches', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: async (v) => (v === 'b@y.com' ? 'rec-1' : null),
      }
    )
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('rec-1')
  })

  it('errors the row when two elements match DIFFERENT records (ambiguous)', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: async (v) => (v === 'a@x.com' ? 'rec-1' : 'rec-2'),
      }
    )
    expect(result.strategy).toBe('skip')
    expect(result.errors.some((e) => e.includes('multiple different records'))).toBe(true)
    expect(result.existingRecordId).toBeUndefined()
  })

  it('plans a create with the full array when nothing matches', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: async () => null,
      }
    )
    expect(result.strategy).toBe('create')
    expect(result.resolvedData.primary_email).toEqual(['a@x.com', 'b@y.com'])
  })

  it('still matches a scalar identifier by the raw trimmed cell', async () => {
    const raw = 'a@x.com'
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions: new Map(),
        findExistingRecord: async (v) => (v === 'a@x.com' ? 'rec-9' : null),
      }
    )
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('rec-9')
  })
})

describe('analyzeRow — warnings', () => {
  it('propagates a warning-typed resolution as a row warning and uses the valid subset', async () => {
    const raw = 'a@x.com, broken'
    const resolutions = new Map([
      [
        hashValue(raw),
        resolution(raw, {
          type: 'warning',
          value: ['a@x.com'],
          warning: 'Dropped invalid value: broken',
        }),
      ],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        mappings: [mapping({})],
        resolutions,
      }
    )
    expect(result.strategy).toBe('create')
    expect(result.resolvedData.primary_email).toEqual(['a@x.com'])
    expect(result.warnings).toEqual(['Column "Email": Dropped invalid value: broken'])
    expect(result.errors).toEqual([])
  })
})
