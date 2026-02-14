// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-data-utils.ts

import type { INodeProperty } from '@auxx/workflow-nodes/types'

/**
 * Check if a field contains sensitive data
 */
export function isSensitiveField(property: INodeProperty): boolean {
  // Check field type
  if (property.type === 'password' || property.typeOptions?.password) {
    return true
  }

  // Check field name patterns
  const fieldName = property.name.toLowerCase()
  const sensitivePatterns = [
    'password',
    'passwd',
    'pwd',
    'key',
    'secret',
    'token',
    'auth',
    'credential',
    'privatekey',
    'passphrase',
  ]

  return sensitivePatterns.some((pattern) => fieldName.includes(pattern))
}

/**
 * Filter credential data for edit mode, removing empty sensitive fields
 * This prevents overwriting existing sensitive values with empty strings
 */
export function filterCredentialDataForEdit(
  data: Record<string, any>,
  properties: INodeProperty[]
): Record<string, any> {
  const filteredData: Record<string, any> = {}

  for (const [key, value] of Object.entries(data)) {
    const property = properties.find((p) => p.name === key)

    if (property && isSensitiveField(property)) {
      // For sensitive fields, only include if they have a value
      if (value !== undefined && value !== null && value !== '') {
        filteredData[key] = value
      }
      // Skip empty sensitive fields - they won't overwrite existing values
    } else {
      // For non-sensitive fields, always include (even if empty)
      filteredData[key] = value
    }
  }

  return filteredData
}

/**
 * Check if any sensitive fields have been modified (have values)
 */
export function hasSensitiveFieldChanges(
  data: Record<string, any>,
  properties: INodeProperty[]
): boolean {
  for (const [key, value] of Object.entries(data)) {
    const property = properties.find((p) => p.name === key)

    if (property && isSensitiveField(property)) {
      if (value !== undefined && value !== null && value !== '') {
        return true
      }
    }
  }

  return false
}
