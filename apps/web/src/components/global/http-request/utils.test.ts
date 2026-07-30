// apps/web/src/components/global/http-request/utils.test.ts

import { describe, expect, it } from 'vitest'
import type { KeyValue } from './types'
import {
  keyValueToRecord,
  keyValueToString,
  parseHeadersToKeyValue,
  recordToKeyValue,
} from './utils'

describe('HTTP utils serialization', () => {
  it('should handle plain text key-value pairs', () => {
    const input = 'Content-Type:application/json\nAuthorization:Bearer token123'
    const parsed = parseHeadersToKeyValue(input)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      key: 'Content-Type',
      value: 'application/json',
    })
    expect(parsed[1]).toMatchObject({
      key: 'Authorization',
      value: 'Bearer token123',
    })

    // Should serialize back to same format
    const serialized = keyValueToString(parsed)
    expect(serialized).toBe(input)
  })

  it('should handle TipTap JSON content', () => {
    const tiptapKey = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'X-Custom-' },
            { type: 'variable-node', attrs: { variableId: 'var_123', label: 'headerName' } },
          ],
        },
      ],
    }

    const tiptapValue = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Value with ' },
            { type: 'variable-node', attrs: { variableId: 'var_456', label: 'headerValue' } },
          ],
        },
      ],
    }

    const keyValue: KeyValue[] = [
      {
        id: '1',
        key: 'X-Custom-{{var_123}}',
        keyEditorContent: tiptapKey,
        value: 'Value with {{var_456}}',
        valueEditorContent: tiptapValue,
      },
    ]

    // Serialize - uses key:value format
    const serialized = keyValueToString(keyValue)
    expect(serialized).toBe('X-Custom-{{var_123}}:Value with {{var_456}}')

    // Deserialize
    const parsed = parseHeadersToKeyValue(serialized)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].key).toBe('X-Custom-{{var_123}}')
    expect(parsed[0].value).toBe('Value with {{var_456}}')
  })

  it('should handle mixed content (some with TipTap, some without)', () => {
    const keyValue: KeyValue[] = [
      {
        id: '1',
        key: 'Simple-Header',
        value: 'Simple Value',
      },
      {
        id: '2',
        key: 'Complex-{{var_123}}',
        keyEditorContent: { type: 'doc', content: [] },
        value: 'Complex Value',
        valueEditorContent: { type: 'doc', content: [] },
      },
    ]

    const serialized = keyValueToString(keyValue)
    const lines = serialized.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('Simple-Header:Simple Value')
    expect(lines[1]).toBe('Complex-{{var_123}}:Complex Value')

    // Should parse correctly
    const parsed = parseHeadersToKeyValue(serialized)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].key).toBe('Simple-Header')
    expect(parsed[1].key).toBe('Complex-{{var_123}}')
  })

  it('should handle empty values', () => {
    const input = ''
    const parsed = parseHeadersToKeyValue(input)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].key).toBe('')
    expect(parsed[0].value).toBe('')
  })

  // Blank rows are PRESERVED as a bare ':' so a row the user just added does not
  // vanish from the editor mid-edit; they round-trip back as a blank row, and
  // `keyValueToRecord` is what drops them before anything is persisted.
  it('should keep empty rows when serializing, as a bare colon', () => {
    const keyValue: KeyValue[] = [
      { id: '1', key: 'Header1', value: 'Value1' },
      { id: '2', key: '', value: '' },
      { id: '3', key: 'Header3', value: 'Value3' },
    ]

    const serialized = keyValueToString(keyValue)
    const lines = serialized.split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Header1:Value1')
    expect(lines[1]).toBe(':')
    expect(lines[2]).toBe('Header3:Value3')

    // The blank row survives the round-trip rather than being dropped...
    const parsed = parseHeadersToKeyValue(serialized)
    expect(parsed).toHaveLength(3)
    expect(parsed[1]).toMatchObject({ key: '', value: '' })

    // ...and is dropped only at the point of persistence.
    expect(keyValueToRecord(parsed)).toEqual({ Header1: 'Value1', Header3: 'Value3' })
  })
})

describe('Record ⇄ KeyValue[] converters', () => {
  it('keyValueToRecord drops blank keys and keeps the last duplicate', () => {
    const list: KeyValue[] = [
      { id: '1', key: 'Authorization', value: 'Bearer a' },
      { id: '2', key: '  ', value: 'ignored' },
      { id: '3', key: 'X-Env', value: 'dev' },
      { id: '4', key: 'X-Env', value: 'prod' },
    ]
    expect(keyValueToRecord(list)).toEqual({ Authorization: 'Bearer a', 'X-Env': 'prod' })
  })

  it('keyValueToRecord trims keys but preserves values verbatim', () => {
    const list: KeyValue[] = [{ id: '1', key: '  Accept  ', value: ' application/json ' }]
    expect(keyValueToRecord(list)).toEqual({ Accept: ' application/json ' })
  })

  it('recordToKeyValue yields a row per entry plus a trailing blank', () => {
    const rows = recordToKeyValue({ a: '1', b: 2 })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ key: 'a', value: '1' })
    expect(rows[1]).toMatchObject({ key: 'b', value: '2' }) // non-string coerced
    expect(rows[2]).toMatchObject({ key: '', value: '' })
  })

  it('recordToKeyValue returns a single blank row for empty / nullish input', () => {
    for (const input of [undefined, null, {}]) {
      const rows = recordToKeyValue(input)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ key: '', value: '' })
    }
  })

  it('round-trips a record through KeyValue[] and back', () => {
    const rec = { Authorization: 'Bearer x', 'X-Api-Version': '2026-06' }
    expect(keyValueToRecord(recordToKeyValue(rec))).toEqual(rec)
  })
})
