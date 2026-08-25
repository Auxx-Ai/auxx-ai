// packages/lib/src/import/resolution/get-unique-values-with-status.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, count, desc, eq } from 'drizzle-orm'
import { buildOptionIndex, type FieldOptionItem } from '../../resources/registry/option-helpers'
import { parseResolutionConfig } from '../mapping/resolution-config'
import type { ColumnFieldConfig, OverrideValue, ResolvedValue } from '../types'
import type { RelationCreateRequest } from '../types/resolution'
import {
  deriveEffectiveStatus,
  type EffectiveStatus,
  effectiveOptionKeys,
  type ResolutionStatus,
} from './effective-status'
import { isOptionResolutionType, resolveOptionLabel } from './option-labels'
import { resolveColumnOptions } from './resolve-column-options'

export type { EffectiveStatus, ResolutionStatus } from './effective-status'

/** Unique value with resolution status */
export interface UniqueValueWithResolution {
  hash: string
  rawValue: string
  count: number
  originalStatus: ResolutionStatus // From DB, used for grouping
  effectiveStatus: EffectiveStatus // Derived from override, used for display
  resolvedValue: string | null
  /**
   * The display label(s) this value will actually IMPORT as, for
   * `select:`/`multiselect:` columns, resolved against the LIVE option list
   * (multi values joined with `, `).
   *
   * Effective, not raw: a user override wins over the resolver's answer, so a
   * value re-pointed at another option searches and reads as that option
   * immediately. Null for non-option columns, for a skipped value, and when no
   * part of the value matches an option — a pending option create resolves to
   * null on purpose, its `resolvedValue` is the label to be minted, not a key.
   */
  resolvedLabel: string | null
  resolvedValues: ResolvedValue[]
  errorMessage: string | null
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
  /**
   * Present when `originalStatus === 'create'` for a RELATION column, what
   * will be minted if the import runs. Lets the value-review step render
   * "will be created" with the target and the field it lands on, instead of an
   * empty resolved value.
   */
  relationCreate?: RelationCreateRequest
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
  if (typeof first !== 'object' || first === null) return null
  // A pending relation create has a null `value` by design (nothing is minted
  // until execution); its display string is the cell that will become the
  // record's name.
  const create = (first as ResolvedValue).relationCreate
  if (create) return create.value
  if ('value' in first) {
    return typeof first.value === 'string' ? first.value : String(first.value ?? '')
  }
  return null
}

/** Pull the pending relation-create request off a resolution's first value. */
function extractRelationCreate(resolvedValues: ResolvedValue[]): RelationCreateRequest | undefined {
  return resolvedValues[0]?.relationCreate
}

/**
 * Build field config from mapping property.
 */
function buildFieldConfig(
  mappingProp: {
    targetFieldKey: string | null
    customFieldId: string | null
    resolutionType: string
    resolutionConfig: unknown
  },
  entityDefinitionId: string
): ColumnFieldConfig | null {
  if (!mappingProp.targetFieldKey) return null

  // `resolutionConfig` is a JSON STRING column (`text()`), like every other
  // consumer parses it (resolve-values-job, save-mapping-property,
  // execute-plan-job). Casting the string made `options`/`relationConfig`
  // permanently undefined, which left the review step's option picker dead
  // code and every resolved select value rendering as its raw option key.
  const resolutionConfig = parseResolutionConfig(
    mappingProp.resolutionConfig as string | null | undefined
  )

  // Derive base type from resolution type
  const resolutionType = mappingProp.resolutionType
  let type = 'text'
  // `currency:*` stores an integer in `valueNumber` exactly like NUMBER does,
  // so the review editor treats it as a number, not as free text.
  if (resolutionType.startsWith('number:') || resolutionType.startsWith('currency:'))
    type = 'number'
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
    customFieldId: mappingProp.customFieldId,
    entityDefinitionId,
    options: resolutionConfig?.options,
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

/** Parameters for {@link getUniqueValuesWithResolution} */
export interface GetUniqueValuesParams {
  jobId: string
  mappingId: string
  columnIndex: number
  /** `ImportMapping.organizationId` — scope for the live option lookup */
  organizationId: string
  /** `ImportMapping.entityDefinitionId` — the resource the column targets */
  entityDefinitionId: string
}

/**
 * Get unique values for a column with their resolution status.
 *
 * For select-ish columns the returned `fieldConfig.options` is the LIVE option
 * list (the stored snapshot is client-asserted and never refreshed — same rule
 * as `resolve-values-job`), and each value carries a `resolvedLabel` resolved
 * against that list.
 *
 * @param db - Database instance
 * @param params - Job, mapping, column, and org/def scope
 * @returns Unique values with resolution info and field config
 */
export async function getUniqueValuesWithResolution(
  db: Database,
  params: GetUniqueValuesParams
): Promise<UniqueValuesWithFieldConfig> {
  const { jobId, mappingId, columnIndex, organizationId, entityDefinitionId } = params
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
        resolvedLabel: null,
        resolvedValues: [],
        errorMessage: null,
        isOverridden: false,
        overrideValues: null,
      })),
    }
  }

  // Build field config from mapping property
  const fieldConfig = buildFieldConfig(mappingProp, entityDefinitionId)

  // Overlay the LIVE option list for select-ish columns, same rule as
  // `resolve-values-job`: the live list WINS, the stored snapshot only stands
  // in for a field that has since vanished.
  let optionIndex: Map<string, FieldOptionItem> | null = null
  if (fieldConfig && isOptionResolutionType(fieldConfig.resolutionType)) {
    const liveOptions = await resolveColumnOptions({
      organizationId,
      entityDefinitionId,
      targetFieldKeys: [fieldConfig.key],
    })
    const live = liveOptions.get(fieldConfig.key)
    if (live) fieldConfig.options = live
    optionIndex = buildOptionIndex(fieldConfig.options ?? [])
  }

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
      const resolvedValue = resolution?.resolvedValue ?? null

      return {
        hash: uv.valueHash,
        rawValue: uv.value,
        count: Number(uv.count),
        originalStatus,
        effectiveStatus: deriveEffectiveStatus(originalStatus, isOverridden, overrideValues),
        resolvedValue,
        resolvedLabel: resolveOptionLabel(
          effectiveOptionKeys(resolvedValue, isOverridden, overrideValues),
          optionIndex
        ),
        resolvedValues: resolution?.resolvedValues ?? [],
        errorMessage: resolution?.errorMessage ?? null,
        isOverridden,
        overrideValues,
        relationCreate: extractRelationCreate(resolution?.resolvedValues ?? []),
      }
    }),
  }
}
