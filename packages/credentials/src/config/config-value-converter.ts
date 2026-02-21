// packages/credentials/src/config/config-value-converter.ts

import type { ConfigVariableType } from '@auxx/types/config'

/**
 * Convert a raw string (from process.env) to the correct type.
 */
export function convertEnvValue(
  raw: string | undefined,
  type: ConfigVariableType
): string | number | boolean | string[] | undefined {
  if (raw === undefined || raw === '') return undefined

  switch (type) {
    case 'STRING':
      return raw
    case 'NUMBER': {
      const num = Number(raw)
      return isNaN(num) ? undefined : num
    }
    case 'BOOLEAN':
      return raw === 'true' || raw === '1' || raw === 'yes'
    case 'ENUM':
      return raw
    case 'ARRAY':
      try {
        return JSON.parse(raw)
      } catch {
        return raw.split(',').map((s) => s.trim())
      }
    default:
      return raw
  }
}

/**
 * Convert a typed value to a string (for display or env var format).
 */
export function valueToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value)
}
