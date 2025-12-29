// apps/web/src/components/workflow/nodes/core/http/utils.test.ts

import { describe, it, expect } from 'vitest'
import { parseHeadersToKeyValue, keyValueToString } from './utils'
import type { KeyValue } from './types'

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

    // Serialize
    const serialized = keyValueToString(keyValue)
    expect(serialized).toContain('[') // Should use JSON array format

    // Deserialize
    const parsed = parseHeadersToKeyValue(serialized)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].keyEditorContent).toEqual(tiptapKey)
    expect(parsed[0].valueEditorContent).toEqual(tiptapValue)
    expect(parsed[0].key).toContain('X-Custom-')
    expect(parsed[0].value).toContain('Value with')
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
    expect(lines[0]).toBe('Simple-Header:Simple Value') // Legacy format
    expect(lines[1]).toContain('[') // JSON array format

    // Should parse correctly
    const parsed = parseHeadersToKeyValue(serialized)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].key).toBe('Simple-Header')
    expect(parsed[1].keyEditorContent).toBeDefined()
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
