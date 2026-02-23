// apps/web/src/components/workflow/nodes/core/http/utils.test.ts

import { describe, expect, it } from 'vitest'
import type { KeyValue } from './types'
import { keyValueToString, parseHeadersToKeyValue } from './utils'

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

  it('should filter out empty rows when serializing', () => {
    const keyValue: KeyValue[] = [
      { id: '1', key: 'Header1', value: 'Value1' },
      { id: '2', key: '', value: '' },
      { id: '3', key: 'Header3', value: 'Value3' },
    ]

    const serialized = keyValueToString(keyValue)
    const lines = serialized.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('Header1:Value1')
    expect(lines[1]).toBe('Header3:Value3')
  })
})
