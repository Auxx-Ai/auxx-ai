// packages/lib/src/resources/crud/utils/change-tracker.ts

/**
 * Represents a single field change
 */
export interface FieldChange {
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Compare old and new records, return list of changes.
 * Works for any resource type.
 *
 * @param oldRecord - The existing record
 * @param newData - The incoming update data
 * @param trackedFields - Fields to track changes for (defaults to all keys in newData)
 */
export function trackChanges(
  oldRecord: Record<string, unknown>,
  newData: Record<string, unknown>,
  trackedFields?: string[]
): FieldChange[] {
  const changes: FieldChange[] = []
  const fieldsToCheck = trackedFields ?? Object.keys(newData)

  for (const field of fieldsToCheck) {
    const newValue = newData[field]
    // Only track if new value is explicitly provided (not undefined)
    if (newValue === undefined) continue

    const oldValue = oldRecord[field]
    if (newValue !== oldValue) {
      changes.push({ field, oldValue, newValue })
    }
  }

  return changes
}

/**
 * Check if record has any changes worth updating.
 */
export function hasChanges(
  oldRecord: Record<string, unknown>,
  newData: Record<string, unknown>
): boolean {
  return trackChanges(oldRecord, newData).length > 0
}
