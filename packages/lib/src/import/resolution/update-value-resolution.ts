// packages/lib/src/import/resolution/update-value-resolution.ts

import { eq, and } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { OverrideValue, ResolvedValue } from '../types'

/** Input for updating a value resolution */
export interface UpdateResolutionInput {
  jobId: string
  mappingId: string
  columnIndex: number
  hash: string
  isOverridden: boolean
  overrideValues: OverrideValue[] | null // null to clear override
}

/** User override data stored in JSONB */
interface UserOverrideData {
  isOverridden: boolean
  values: OverrideValue[]
  originalIsValid: boolean // Store original for revert
  originalResolvedValues: ResolvedValue[] // Store original for revert
}

/**
 * Update a single value resolution with user override.
 * - `status` is NOT updated - keeps original for UI grouping
 * - `isValid` IS updated - affects execution (true for value, false for skip)
 *
 * @param db - Database instance
 * @param input - Update input
 */
export async function updateValueResolution(
  db: Database,
  input: UpdateResolutionInput
): Promise<void> {
  const now = new Date()

  // Get mapping property
  const mappingProp = await db.query.ImportMappingProperty.findFirst({
    where: and(
      eq(schema.ImportMappingProperty.importMappingId, input.mappingId),
      eq(schema.ImportMappingProperty.sourceColumnIndex, input.columnIndex)
    ),
  })

  if (!mappingProp) {
    throw new Error('Mapping property not found')
  }

  // Get or create job property
  let jobProp = await db.query.ImportJobProperty.findFirst({
    where: and(
      eq(schema.ImportJobProperty.importJobId, input.jobId),
      eq(schema.ImportJobProperty.importMappingPropertyId, mappingProp.id)
    ),
  })

  if (!jobProp) {
    const [newJobProp] = await db
      .insert(schema.ImportJobProperty)
      .values({
        importJobId: input.jobId,
        importMappingPropertyId: mappingProp.id,
        updatedAt: now,
      })
      .returning()

    if (!newJobProp) {
      throw new Error('Failed to create job property')
    }
    jobProp = newJobProp
  }

  // Get existing resolution to preserve original values
  const existingResolution = await db.query.ImportValueResolution.findFirst({
    where: and(
      eq(schema.ImportValueResolution.importJobPropertyId, jobProp.id),
      eq(schema.ImportValueResolution.hashedValue, input.hash)
    ),
  })

  // Clear override - revert to auto-resolved value
  if (!input.isOverridden || !input.overrideValues) {
    if (!existingResolution) return

    // Get original values from stored override or current values
    const storedOverride = existingResolution.userOverride as UserOverrideData | null
    const originalIsValid = storedOverride?.originalIsValid ?? existingResolution.isValid
    const originalResolvedValues = storedOverride?.originalResolvedValues ??
      (existingResolution.resolvedValues as ResolvedValue[])

    await db
      .update(schema.ImportValueResolution)
      .set({
        userOverride: null,
        overriddenAt: null,
        isValid: originalIsValid,
        resolvedValues: originalResolvedValues,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.ImportValueResolution.importJobPropertyId, jobProp.id),
          eq(schema.ImportValueResolution.hashedValue, input.hash)
        )
      )
    return
  }

  // Determine isValid based on override type
  const isSkip = input.overrideValues[0]?.type === 'skip'
  const newIsValid = !isSkip // Valid if not skipped

  // Build resolved values from override
  const resolvedValues: ResolvedValue[] = isSkip
    ? [] // Empty for skip
    : input.overrideValues.map((ov) => ({
        type: ov.type,
        value: ov.id ?? ov.value,
      }))

  // Store original values for revert (only if not already overridden)
  const existingOverride = existingResolution?.userOverride as UserOverrideData | null
  const originalIsValid = existingOverride?.originalIsValid ??
    existingResolution?.isValid ?? true
  const originalResolvedValues = existingOverride?.originalResolvedValues ??
    (existingResolution?.resolvedValues as ResolvedValue[] | undefined) ?? []

  const userOverride: UserOverrideData = {
    isOverridden: true,
    values: input.overrideValues,
    originalIsValid,
    originalResolvedValues,
  }

  // Update or create value resolution with override
  // NOTE: `status` is NOT updated - keeps original for UI grouping
  await db
    .insert(schema.ImportValueResolution)
    .values({
      importJobPropertyId: jobProp.id,
      hashedValue: input.hash,
      rawValue: '', // Will be filled from raw data if needed
      resolvedValues,
      status: 'pending', // Default for new, won't be used for grouping if inserted fresh
      isValid: newIsValid,
      userOverride,
      overriddenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.ImportValueResolution.importJobPropertyId,
        schema.ImportValueResolution.hashedValue,
      ],
      set: {
        resolvedValues,
        userOverride,
        overriddenAt: now,
        isValid: newIsValid,
        // status: NOT updated - keeps original for grouping
        updatedAt: now,
      },
    })
}
