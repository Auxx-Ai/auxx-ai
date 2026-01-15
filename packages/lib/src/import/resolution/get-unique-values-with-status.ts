// packages/lib/src/import/resolution/get-unique-values-with-status.ts

import { eq, and, count, desc } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ResolvedValue, OverrideValue, ColumnFieldConfig } from '../types'

/** Resolution status types */
export type ResolutionStatus = 'pending' | 'valid' | 'error' | 'warning' | 'create'

/** Effective status includes 'skip' for user-skipped values */
export type EffectiveStatus = ResolutionStatus | 'skip'

/** Unique value with resolution status */
export interface UniqueValueWithResolution {
  hash: string
  rawValue: string
  count: number
  originalStatus: ResolutionStatus // From DB, used for grouping
  effectiveStatus: EffectiveStatus // Derived from override, used for display
  resolvedValue: string | null
  resolvedValues: ResolvedValue[]
  errorMessage: string | null
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
}

/** Return type including field config */
export interface UniqueValuesWithFieldConfig {
  fieldConfig: ColumnFieldConfig | null
  values: UniqueValueWithResolution[]
}

/**
 * Extract the resolved value string from the JSONB resolvedValues field.
 * resolvedValues is stored as: [{ type: 'value' | 'error' | 'warning' | 'create', value?: string }]
 */
function extractResolvedValue(resolvedValues: unknown): string | null {
  if (!resolvedValues || !Array.isArray(resolvedValues) || resolvedValues.length === 0) {
    return null
  }
  const first = resolvedValues[0]
  if (typeof first === 'object' && first !== null && 'value' in first) {
    return typeof first.value === 'string' ? first.value : String(first.value ?? '')
  }
  return null
}

/**
 * Build field config from mapping property.
 */
function buildFieldConfig(mappingProp: {
  targetFieldKey: string | null
  resolutionType: string
  resolutionConfig: unknown
}): ColumnFieldConfig | null {
  if (!mappingProp.targetFieldKey) return null

  const resolutionConfig = mappingProp.resolutionConfig as {
    enumValues?: Array<{ dbValue: string; label: string }>
    relationConfig?: { relatedEntityDefinitionId: string; relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many' }
  } | null

  // Derive base type from resolution type
  const resolutionType = mappingProp.resolutionType
  let type = 'text'
  if (resolutionType.startsWith('number:')) type = 'number'
  else if (resolutionType.startsWith('date')) type = 'date'
  else if (resolutionType.startsWith('boolean:')) type = 'boolean'
  else if (resolutionType.startsWith('select:')) type = 'enum'
  else if (resolutionType.startsWith('multiselect:')) type = 'enum'
  else if (resolutionType.startsWith('relation:')) type = 'relationship'
  else if (resolutionType.startsWith('email:')) type = 'email'
  else if (resolutionType.startsWith('phone:')) type = 'phone'

  return {
    key: mappingProp.targetFieldKey,
    type,
    resolutionType,
    enumValues: resolutionConfig?.enumValues,
    relationConfig: resolutionConfig?.relationConfig,
  }
}

/**
 * Parse user override from JSONB field.
 */
function parseUserOverride(userOverride: unknown): {
  isOverridden: boolean
  values: OverrideValue[] | null
} {
  if (!userOverride || typeof userOverride !== 'object') {
    return { isOverridden: false, values: null }
  }

  const override = userOverride as { isOverridden?: boolean; values?: OverrideValue[] }
  if (override.isOverridden && Array.isArray(override.values)) {
    return { isOverridden: true, values: override.values }
  }

  return { isOverridden: false, values: null }
}

/**
 * Derive effective status from original status and override.
 * - If not overridden, use original status
 * - If overridden with skip, return 'skip'
 * - If overridden with value, return 'valid'
 */
function deriveEffectiveStatus(
  originalStatus: ResolutionStatus,
  isOverridden: boolean,
  overrideValues: OverrideValue[] | null
): EffectiveStatus {
  if (!isOverridden || !overrideValues?.length) {
    return originalStatus
  }
  if (overrideValues[0].type === 'skip') {
    return 'skip'
  }
  return 'valid'
}

/**
 * Get unique values for a column with their resolution status.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param mappingId - Import mapping ID
 * @param columnIndex - Column index
 * @returns Unique values with resolution info and field config
 */
export async function getUniqueValuesWithResolution(
  db: Database,
  jobId: string,
  mappingId: string,
  columnIndex: number
): Promise<UniqueValuesWithFieldConfig> {
  // Get unique values with counts using SQL GROUP BY
  const uniqueValues = await db
    .select({
      value: schema.ImportJobRawData.value,
      valueHash: schema.ImportJobRawData.valueHash,
      count: count(),
    })
    .from(schema.ImportJobRawData)
    .where(
      and(
        eq(schema.ImportJobRawData.importJobId, jobId),
        eq(schema.ImportJobRawData.columnIndex, columnIndex)
      )
    )
    .groupBy(schema.ImportJobRawData.value, schema.ImportJobRawData.valueHash)
    .orderBy(desc(count()))

  // Get mapping property for this column
  const mappingProp = await db.query.ImportMappingProperty.findFirst({
    where: and(
      eq(schema.ImportMappingProperty.importMappingId, mappingId),
      eq(schema.ImportMappingProperty.sourceColumnIndex, columnIndex)
    ),
  })

  if (!mappingProp) {
    // No mapping, return values with pending status
    return {
      fieldConfig: null,
      values: uniqueValues.map((uv) => ({
        hash: uv.valueHash,
        rawValue: uv.value,
        count: Number(uv.count),
        originalStatus: 'pending' as ResolutionStatus,
        effectiveStatus: 'pending' as EffectiveStatus,
        resolvedValue: null,
        resolvedValues: [],
        errorMessage: null,
        isOverridden: false,
        overrideValues: null,
      })),
    }
  }

  // Build field config from mapping property
  const fieldConfig = buildFieldConfig(mappingProp)

  // Get job property
  const jobProp = await db.query.ImportJobProperty.findFirst({
    where: and(
      eq(schema.ImportJobProperty.importJobId, jobId),
      eq(schema.ImportJobProperty.importMappingPropertyId, mappingProp.id)
    ),
  })

  // Build resolution map if job property exists
  let resolutionMap = new Map<
    string,
    {
      status: string
      resolvedValue: string | null
      resolvedValues: ResolvedValue[]
      errorMessage: string | null
      isOverridden: boolean
      overrideValues: OverrideValue[] | null
    }
  >()

  if (jobProp) {
    const resolutions = await db.query.ImportValueResolution.findMany({
      where: eq(schema.ImportValueResolution.importJobPropertyId, jobProp.id),
    })

    resolutionMap = new Map(
      resolutions.map((r) => {
        const resolved = (r.resolvedValues ?? []) as ResolvedValue[]
        const override = parseUserOverride(r.userOverride)
        return [
          r.hashedValue,
          {
            status: r.status,
            resolvedValue: extractResolvedValue(r.resolvedValues),
            resolvedValues: resolved,
            errorMessage: r.errorMessage,
            isOverridden: override.isOverridden,
            overrideValues: override.values,
          },
        ]
      })
    )
  }

  return {
    fieldConfig,
    values: uniqueValues.map((uv) => {
      const resolution = resolutionMap.get(uv.valueHash)
      const originalStatus = (resolution?.status ?? 'pending') as ResolutionStatus
      const isOverridden = resolution?.isOverridden ?? false
      const overrideValues = resolution?.overrideValues ?? null

      return {
        hash: uv.valueHash,
        rawValue: uv.value,
        count: Number(uv.count),
        originalStatus,
        effectiveStatus: deriveEffectiveStatus(originalStatus, isOverridden, overrideValues),
        resolvedValue: resolution?.resolvedValue ?? null,
        resolvedValues: resolution?.resolvedValues ?? [],
        errorMessage: resolution?.errorMessage ?? null,
        isOverridden,
        overrideValues,
      }
    }),
  }
}
