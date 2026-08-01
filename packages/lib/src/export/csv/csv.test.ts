// packages/lib/src/export/csv/csv.test.ts

import { FieldType } from '@auxx/database/enums'
import { toResourceFieldId } from '@auxx/types/field'
import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it } from 'vitest'
import type { TypedFieldValueResult } from '../../field-values/types'
import type { ExportColumn } from '../types'
import { buildRow, fieldRefKey, indexByRecord, serializeCsv } from './build-rows'
import { extractRelationRecordIds, formatCell } from './format-cell'

/** Minimal TypedFieldValueResult factory. */
function result(over: Partial<TypedFieldValueResult>): TypedFieldValueResult {
  return {
    recordId: 'contact:1' as RecordId,
    fieldRef: 'contact:name',
    value: null,
    fieldType: FieldType.TEXT,
    ...over,
  } as TypedFieldValueResult
}

describe('fieldRefKey', () => {
  it('keeps a direct ResourceFieldId as-is', () => {
    expect(fieldRefKey(toResourceFieldId('contact', 'email'))).toBe('contact:email')
  })

  it('joins a FieldPath with ::', () => {
    expect(
      fieldRefKey([toResourceFieldId('product', 'vendor'), toResourceFieldId('vendor', 'name')])
    ).toBe('product:vendor::vendor:name')
  })
})

describe('extractRelationRecordIds', () => {
  it('pulls a single relationship recordId', () => {
    const r = result({
      fieldType: FieldType.RELATIONSHIP,
      value: { type: 'relationship', recordId: 'vendor:9' } as never,
    })
    expect(extractRelationRecordIds(r)).toEqual(['vendor:9'])
  })

  it('pulls all recordIds from an array (has_many)', () => {
    const r = result({
      fieldType: FieldType.RELATIONSHIP,
      value: [
        { type: 'relationship', recordId: 'vendor:9' },
        { type: 'relationship', recordId: 'vendor:10' },
      ] as never,
    })
    expect(extractRelationRecordIds(r)).toEqual(['vendor:9', 'vendor:10'])
  })

  it('returns nothing for non-relationship fields', () => {
    expect(
      extractRelationRecordIds(result({ value: { type: 'text', value: 'x' } as never }))
    ).toEqual([])
  })
})

describe('formatCell', () => {
  const nameCache = new Map<RecordId, string>([['vendor:9' as RecordId, 'Acme Co']])

  it('returns empty string for missing/null cells', () => {
    expect(formatCell(undefined, nameCache)).toBe('')
    expect(formatCell(result({ value: null }), nameCache)).toBe('')
  })

  it('formats a text value', () => {
    expect(
      formatCell(result({ value: { type: 'text', value: 'Hello' } as never }), nameCache)
    ).toBe('Hello')
  })

  it('resolves a relationship to its cached display name', () => {
    const r = result({
      fieldType: FieldType.RELATIONSHIP,
      value: { type: 'relationship', recordId: 'vendor:9' } as never,
    })
    expect(formatCell(r, nameCache)).toBe('Acme Co')
  })

  it('falls back to the raw RecordId when a name is not cached', () => {
    const r = result({
      fieldType: FieldType.RELATIONSHIP,
      value: { type: 'relationship', recordId: 'vendor:99' } as never,
    })
    expect(formatCell(r, nameCache)).toBe('vendor:99')
  })

  it('joins multiple relationship names with ", "', () => {
    const cache = new Map<RecordId, string>([
      ['vendor:9' as RecordId, 'Acme Co'],
      ['vendor:10' as RecordId, 'Globex'],
    ])
    const r = result({
      fieldType: FieldType.RELATIONSHIP,
      value: [
        { type: 'relationship', recordId: 'vendor:9' },
        { type: 'relationship', recordId: 'vendor:10' },
      ] as never,
    })
    expect(formatCell(r, cache)).toBe('Acme Co, Globex')
  })
})

describe('indexByRecord + buildRow', () => {
  const columns: ExportColumn[] = [
    { label: 'Name', fieldRef: toResourceFieldId('contact', 'name') },
    { label: 'Email', fieldRef: toResourceFieldId('contact', 'email') },
  ]

  it('builds cells in column order, empty for missing cells', () => {
    const results = [
      result({
        recordId: 'contact:1' as RecordId,
        fieldRef: toResourceFieldId('contact', 'name'),
        value: { type: 'text', value: 'Ann' } as never,
      }),
      // no email cell for contact:1
    ]
    const byRecord = indexByRecord(results)
    const nameCache = new Map<RecordId, string>()
    expect(buildRow('contact:1' as RecordId, columns, byRecord, nameCache)).toEqual(['Ann', ''])
  })
})

describe('serializeCsv', () => {
  it('prepends a BOM and escapes per RFC 4180', () => {
    const csv = serializeCsv(
      ['Name', 'Note'],
      [
        ['Ann', 'plain'],
        ['Bob, Jr', 'has "quotes"'],
        ['multi\nline', 'ok'],
      ]
    )
    const lines = csv.split('\n')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe('﻿Name,Note')
    expect(lines[1]).toBe('Ann,plain')
    expect(lines[2]).toBe('"Bob, Jr","has ""quotes"""')
    // The embedded newline keeps the quoted cell across the raw split.
    expect(csv).toContain('"multi\nline",ok')
  })

  it('preserves duplicate column labels', () => {
    const csv = serializeCsv(['Name', 'Name'], [['a', 'b']])
    expect(csv).toBe('﻿Name,Name\na,b')
  })
})
