// apps/web/src/components/workflow/nodes/core/http/utils.ts

import { generateId } from '@auxx/utils/generateId'
import type { Body, BodyPayload, KeyValue } from './types'
import { BodyPayloadValueType, BodyType } from './types'

// Re-export generateId for convenience
export { generateId }

/**
 * Convert stored format to KeyValue[]
 * Supports both legacy "key:value" format and new JSON array format
 */
export function parseHeadersToKeyValue(headers: string): KeyValue[] {
  if (!headers || headers.trim() === '') {
    return [{ id: generateId(), key: '', value: '' }]
  }

  const lines = headers.split('\n').filter((line) => line.trim() !== '')

  if (lines.length === 0) {
    return [{ id: generateId(), key: '', value: '' }]
  }

  return lines.map((line) => {
    // Try to parse as JSON array format first (new format)
    if (line.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(line)
        if (Array.isArray(parsed) && parsed.length >= 2) {
          const [keyData, valueData] = parsed

          return { id: generateId(), key: String(keyData), value: String(valueData) }
        }
      } catch {}
    }

    // Fall back to legacy colon-separated format
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      return { id: generateId(), key: line.trim(), value: '' }
    }

    const key = line.substring(0, colonIndex).trim()
    const value = line.substring(colonIndex + 1).trim()

    return { id: generateId(), key, value }
  })
}

/**
 * Convert "key1:value1\nkey2:value2" to KeyValue[] (alias for headers)
 */
export function parseParamsToKeyValue(params: string): KeyValue[] {
  return parseHeadersToKeyValue(params)
}

/**
 * Convert KeyValue[] back to string format
 * Uses JSON array format to properly store TipTap JSON content
 */
export function keyValueToString(list: KeyValue[]): string {
  console.log('keyValueToString called with list:', list)
  // Filter out completely empty rows (both key and value are empty)
  const validItems = list.filter((item) => {
    const keyText = item.key.trim()
    const valueText = item.value.trim()
    return keyText !== '' || valueText !== ''
  })

  // If no valid items, return empty string
  if (validItems.length === 0) {
    return ''
  }

  return validItems
    .map((item) => {
      return `${item.key}:${item.value}`
    })
    .join('\n')
}

/**
 * Convert KeyValue[] to headers string (alias)
 */
export function keyValueToHeaders(list: KeyValue[]): string {
  return keyValueToString(list)
}

/**
 * Convert KeyValue[] to params string (alias)
 */
export function keyValueToParams(list: KeyValue[]): string {
  return keyValueToString(list)
}

/**
 * Convert BodyPayload to KeyValue[] for form data and URL encoded body types
 */
export function parseBodyDataToKeyValue(data: BodyPayload): KeyValue[] {
  if (!data || data.length === 0) {
    return [{ id: generateId(), key: '', value: '' }]
  }

  return data.map((item) => ({
    id: item.id || generateId(),
    key: item.key || '',
    value: item.value || '',
    type: item.type === BodyPayloadValueType.file ? 'file' : 'text',
    file: item.file,
  }))
}

/**
 * Convert KeyValue[] to BodyPayload for form data and URL encoded body types
 */
export function keyValueToBodyPayload(kvList: KeyValue[]): BodyPayload {
  return kvList
    .filter((item) => item.key.trim() !== '' || item.value.trim() !== '')
    .map((item) => ({
      id: item.id || generateId(),
      key: item.key,
      type: item.type === 'file' ? BodyPayloadValueType.file : BodyPayloadValueType.text,
      file: item.file,
      value: item.value,
    }))
}

/**
 * Get body content as string for text-based body types (JSON, raw text)
 */
export function getBodyContent(body: Body): string {
  if (!body || !body.data || body.data.length === 0) {
    return ''
  }

  // For text-based body types, the content is stored in the first item's value
  if (body.type === BodyType.json || body.type === BodyType.rawText) {
    return body.data[0]?.value || ''
  }

  // For binary type, return the file selector path
  if (body.type === BodyType.binary && body.data[0]?.file) {
    return JSON.stringify(body.data[0].file)
  }

  return ''
}

/**
 * Set body content for text-based body types
 */
export function setBodyContent(body: Body, content: string): Body {
  const newBody = { ...body }

  if (body.type === BodyType.json || body.type === BodyType.rawText) {
    newBody.data = [{ id: generateId(), type: BodyPayloadValueType.text, value: content }]
  }

  return newBody
}

/**
 * Set body file reference for binary type
 */
export function setBodyFileReference(body: Body, fileRef: string[]): Body {
  const newBody = { ...body }

  if (body.type === BodyType.binary) {
    newBody.data = [{ id: generateId(), type: BodyPayloadValueType.file, file: fileRef }]
  }

  return newBody
}
