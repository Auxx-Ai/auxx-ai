// packages/lib/src/import/resolution/update-value-resolution.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import { parseResolutionConfig } from '../mapping/resolution-config'
import type { OverrideValue, ResolvedValue } from '../types'
import type { ResolutionConfig, ResolutionType } from '../types/resolution'
import { isOptionResolutionType } from './option-labels'
import { resolveColumnCurrencyCodes } from './resolve-currency-code'
import { resolveValue } from './resolve-value'

/** Input for updating a value resolution */
export interface UpdateResolutionInput {
  jobId: string
  mappingId: string
  columnIndex: number
  hash: string
  isOverridden: boolean
  overrideValues: OverrideValue[] | null // null to clear override
  /** `ImportMapping.organizationId` — scope for the run-time currency lookup */
  organizationId: string
  /** `ImportMapping.entityDefinitionId` — the resource the column targets */
  entityDefinitionId: string
}

/** User override data stored in JSONB */
interface UserOverrideData {
  isOverridden: boolean
  values: OverrideValue[]
  originalIsValid: boolean // Store original for revert
  originalResolvedValues: ResolvedValue[] // Store original for revert
}

/**
 * Whether a typed-in override for this column has to go back through the
 * resolver before it is stored.
 *
 * 🛑 An override is RAW USER INPUT, in exactly the same sense a CSV cell is.
 * Storing it verbatim is only safe where the editor can emit nothing but an
 * already-resolved token:
 *
 * - option columns — the picker emits option KEYS, and a key is the resolved form
 * - relation columns — the override carries the target record's `id`
 *
 * Everywhere else the editor is a free text box, and the resolved form is not
 * the typed form. `currency:major` is the case that makes this a defect rather
 * than a nicety: CURRENCY is stored as integer MINOR units, so a typed `12.34`
 * written straight through reaches `field-value-helpers` unscaled and the row
 * fails at execution ("CURRENCY values are integer minor units") — long after
 * the review step said the value was fixed. `number:*`, `date:*`, the `:split`
 * families and `text:cuid` all have the same shape of gap.
 *
 * @param resolutionType - The column's stored resolution type
 * @returns True when the override must be re-resolved
 */
function overrideNeedsResolving(resolutionType: string): boolean {
  if (isOptionResolutionType(resolutionType)) return false
  return !resolutionType.startsWith('relation:')
}

/**
 * Re-resolve a free-text override, or fail loudly.
 *
 * The resolver never throws (see {@link resolveValue}), so an unusable value
 * arrives as `{ type: 'error' }`. It must NOT be persisted as the override's
 * resolved form: `deriveEffectiveStatus` reports any non-skip override as
 * `valid`, so the review row would render a green "Fixed" tick over a value
 * that cannot import. Refusing the write is what keeps those two honest — the
 * caller rolls its optimistic patch back and surfaces the resolver's own
 * message.
 *
 * @param overrides - The non-skip override entries
 * @param resolutionType - The column's stored resolution type
 * @param config - The column's resolution config, currency code already injected
 * @returns The resolver's own values, in order
 */
function resolveOverrides(
  overrides: Array<OverrideValue & { type: 'value' | 'create' }>,
  resolutionType: string,
  config: ResolutionConfig
): ResolvedValue[] {
  return overrides.map((override) => {
    // A `create` entry names something that does not exist yet, so there is
    // nothing to resolve it against — it passes through as it always has.
    if (override.type === 'create') return { type: 'create', value: override.value }

    const resolved = resolveValue(override.value, resolutionType as ResolutionType, config)
    if (resolved.type === 'error') {
      throw new UnprocessableEntityError(
        resolved.error ?? `"${override.value}" is not a valid value for this column`
      )
    }
    return resolved
  })
}

/**
 * The config a re-resolved override must be read with.
 *
 * The stored `resolutionConfig` carries the column's POLICY (`dateFormat`,
 * `arraySeparator`, …), but `currencyCode` is deliberately NOT persisted — a
 * field that inherits `organization.currency` would keep scaling by a frozen
 * exponent — so it is resolved here at write time, exactly as
 * `resolve-values-job` resolves it at run time. Reading a money override with
 * the wrong exponent is off by a factor of 100, silently.
 *
 * @param db - Database instance (for the org-settings read)
 * @param mappingProp - The column's stored type, target key and config
 * @param scope - Org and target resource
 * @returns The resolution config to hand the resolver
 */
async function buildOverrideConfig(
  db: Database,
  mappingProp: { resolutionType: string; targetFieldKey: string | null; resolutionConfig: unknown },
  scope: { organizationId: string; entityDefinitionId: string }
): Promise<ResolutionConfig> {
  const config = parseResolutionConfig(mappingProp.resolutionConfig as string | null | undefined)
  if (!mappingProp.resolutionType.startsWith('currency:') || !mappingProp.targetFieldKey) {
    return config
  }

  const codes = await resolveColumnCurrencyCodes(db, {
    organizationId: scope.organizationId,
    entityDefinitionId: scope.entityDefinitionId,
    targetFieldKeys: [mappingProp.targetFieldKey],
  })
  const currencyCode = codes.get(mappingProp.targetFieldKey)
  return currencyCode ? { ...config, currencyCode } : config
}

/**
 * Update a single value resolution with user override.
 * - `status` is NOT updated - keeps original for UI grouping
 * - `isValid` IS updated - affects execution (true for value, false for skip)
 *
 * A free-text override is RE-RESOLVED before it is stored (see
 * {@link overrideNeedsResolving}); an option or relation override is stored as
 * given, because its editor can only emit an already-resolved key.
 *
 * @param db - Database instance
 * @param input - Update input
 * @throws UnprocessableEntityError when a typed value cannot be resolved
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
    const originalResolvedValues =
      storedOverride?.originalResolvedValues ??
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
  // `skip` is an `OverrideValue` type with no `ResolvedValue` counterpart, so it
  // never reaches the persisted jsonb — the whole-cell skip above already emptied
  // the list, and a `skip` mixed in behind a non-skip first entry is dropped here
  // rather than written out as an unknown `type`.
  const overrides = input.overrideValues.filter(
    (ov): ov is OverrideValue & { type: 'value' | 'create' } => ov.type !== 'skip'
  )

  // A multi-valued column MUST persist the resolver's native shape: ONE entry
  // whose `value` is the array of option keys (see `resolveMultiselectSplit`).
  // Every executor reads `resolvedValues[0]` only — N separate entries would
  // import exactly the first option and silently drop the rest.
  const isMultiValued = mappingProp.resolutionType.startsWith('multiselect:')

  const resolvedValues: ResolvedValue[] = isSkip
    ? [] // Empty for skip
    : isMultiValued
      ? [{ type: 'value', value: overrides.map((ov) => ov.id ?? ov.value) }]
      : overrideNeedsResolving(mappingProp.resolutionType)
        ? resolveOverrides(
            overrides,
            mappingProp.resolutionType,
            await buildOverrideConfig(db, mappingProp, {
              organizationId: input.organizationId,
              entityDefinitionId: input.entityDefinitionId,
            })
          )
        : overrides.map((ov) => ({ type: ov.type, value: ov.id ?? ov.value }))

  // Store original values for revert (only if not already overridden)
  const existingOverride = existingResolution?.userOverride as UserOverrideData | null
  const originalIsValid = existingOverride?.originalIsValid ?? existingResolution?.isValid ?? true
  const originalResolvedValues =
    existingOverride?.originalResolvedValues ??
    (existingResolution?.resolvedValues as ResolvedValue[] | undefined) ??
    []

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
