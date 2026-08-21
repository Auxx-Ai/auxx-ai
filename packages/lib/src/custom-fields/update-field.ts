// packages/lib/src/custom-fields/update-field.ts

import { database, schema } from '@auxx/database'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { CustomFieldEntity, FieldType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { fromDatabase } from '@auxx/services/shared/utils'
import {
  type ActorOptions,
  type AiOptions,
  type CalcOptions,
  canFieldBeUnique,
  getInverseFieldId,
  isDisplayOptions,
  mergeDisplayOptions,
  type RelationshipConfig,
  type SelectOption,
  supportsDisplayOptions,
} from '@auxx/types/custom-field'
import {
  buildFieldValueKey,
  type FieldId,
  parseResourceFieldId,
  type ResourceFieldId,
} from '@auxx/types/field'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, inArray } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { updateSearchTextForInstances } from '../field-values/search-text'
import { buildOptionIndex, type FieldOptionItem } from '../resources/registry/option-helpers'
import { checkExistingDuplicates } from './check-unique-value'
import type { CustomFieldNotFoundError } from './errors'
import { isProtectedField } from './ownership'
import type { CustomFieldOptionsInput } from './types'
import { validateAiOptions } from './validate-ai-options'

const logger = createScopedLogger('custom-fields')

function pickAiOptions(options: unknown): AiOptions | undefined {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return undefined
  const ai = (options as { ai?: unknown }).ai
  return ai as AiOptions | undefined
}

function pickSelectOptions(options: unknown): SelectOption[] | undefined {
  if (!options) return undefined
  if (Array.isArray(options)) return options as SelectOption[]
  if (typeof options === 'object') {
    const inner = (options as { options?: unknown }).options
    if (Array.isArray(inner)) return inner as SelectOption[]
  }
  return undefined
}

/**
 * Field types whose stored value is an option key in `FieldValue.optionId`.
 *
 * Takes a plain `string`: the stored `CustomField.type` column widens to a
 * slightly different union than `FieldType` (it still carries the retired
 * `PHONE` member), so narrowing here would reject the value this function is
 * always called with.
 */
function isOptionBackedType(fieldType: string): boolean {
  return (
    fieldType === FieldTypeEnum.SINGLE_SELECT ||
    fieldType === FieldTypeEnum.MULTI_SELECT ||
    fieldType === FieldTypeEnum.TAGS
  )
}

interface OptionCascadeArgs {
  organizationId: string
  fieldId: string
  /** The field's own def, used to address the per-def realtime record channel. */
  entityDefinitionId: string | null
  /** The option list as it was BEFORE the patch. */
  before: FieldOptionItem[]
  /** The option list the patch carried. */
  after: FieldOptionItem[]
}

/**
 * Cascade an option-list edit onto the values that reference it.
 *
 * Three arms, one pass:
 * - **removed** — a key that left the list genuinely means "deleted" (option
 *   identity is minted once and never rewritten), so its `FieldValue` rows go
 *   with it. Without this every delete leaves values pointing at an id that no
 *   longer resolves.
 * - **relabeled** — `search-text.ts` indexes the RESOLVED LABEL, so renaming an
 *   option leaves every carrying record findable by the old name and not by the
 *   new one until the corpus is rebuilt. Same seam, same helper, no extra query.
 * - both arms feed one `searchText` rebuild and one realtime publish.
 *
 * The diff matches BOTH keyspaces via {@link buildOptionIndex}: a row written
 * before an option gained an explicit `id` still holds its `value`, so diffing
 * on `.value` alone would delete live values.
 *
 * Best-effort by design. The `CustomField` row is already committed by the time
 * this runs, and a retry would compute an EMPTY removed set (stored now equals
 * the patch), so throwing would both misreport a successful update as failed
 * and permanently forfeit the cascade. A failure here degrades to today's
 * behaviour — orphaned values — and is logged.
 */
async function cascadeOptionChanges(args: OptionCascadeArgs): Promise<void> {
  const { organizationId, fieldId, entityDefinitionId } = args

  const beforeIndex = buildOptionIndex(args.before)
  const afterIndex = buildOptionIndex(args.after)

  const removedKeys: string[] = []
  const relabeledKeys: string[] = []
  for (const [key, option] of beforeIndex) {
    const next = afterIndex.get(key)
    if (!next) {
      removedKeys.push(key)
    } else if ((next.label ?? '') !== (option.label ?? '')) {
      relabeledKeys.push(key)
    }
  }

  if (removedKeys.length === 0 && relabeledKeys.length === 0) return

  try {
    const affected = new Set<string>()

    // Both statements ride the existing partial index
    // `FieldValue_lookup_option_idx` on
    // (organizationId, fieldId, optionId) WHERE optionId IS NOT NULL.
    if (removedKeys.length > 0) {
      const deleted = await database
        .delete(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, fieldId),
            inArray(schema.FieldValue.optionId, removedKeys)
          )
        )
        .returning({ entityId: schema.FieldValue.entityId })
      for (const row of deleted) affected.add(row.entityId)
    }

    if (relabeledKeys.length > 0) {
      const touched = await database
        .selectDistinct({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, fieldId),
            inArray(schema.FieldValue.optionId, relabeledKeys)
          )
        )
      for (const row of touched) affected.add(row.entityId)
    }

    if (affected.size === 0) return
    const entityIds = [...affected]

    await updateSearchTextForInstances(database, organizationId, entityIds)

    // The record channel is keyed by def; without one there is nowhere to
    // publish. The rows are already correct either way.
    if (!entityDefinitionId) return

    // Re-read what SURVIVED so the publish can carry the new value. A
    // value-less entry is silently dropped by the realtime layer, and a
    // list-level invalidate does not cover UPDATED rows — so peers would keep
    // rendering the deleted option until a manual refetch.
    const remaining = await database
      .select({
        id: schema.FieldValue.id,
        entityId: schema.FieldValue.entityId,
        optionId: schema.FieldValue.optionId,
        sortKey: schema.FieldValue.sortKey,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, fieldId),
          inArray(schema.FieldValue.entityId, entityIds)
        )
      )
      .orderBy(schema.FieldValue.sortKey)

    const byEntity = new Map<string, Array<Record<string, unknown>>>()
    for (const row of remaining) {
      const bucket = byEntity.get(row.entityId) ?? []
      bucket.push({
        id: row.id,
        entityId: row.entityId,
        fieldId,
        sortKey: row.sortKey,
        type: 'option',
        optionId: row.optionId ?? '',
      })
      byEntity.set(row.entityId, bucket)
    }

    // All three option-backed types are array-return
    // (`ARRAY_RETURN_FIELD_TYPES` includes SINGLE_SELECT), so the entry always
    // carries an array — EMPTY when the cascade removed the record's only
    // value, which is exactly what lets peers clear the cell.
    const entries = entityIds.map((entityId) => ({
      key: buildFieldValueKey(toRecordId(entityDefinitionId, entityId), fieldId as FieldId),
      value: byEntity.get(entityId) ?? [],
    }))

    // Lazy-import the realtime barrel: the load-time cycle
    // (realtime → publish-helpers → cache) breaks vi.mock.
    const { getRealtimeService, publishFieldValueUpdates } = await import('../realtime')
    await publishFieldValueUpdates(getRealtimeService(), organizationId, entries)
  } catch (error) {
    logger.error('Option cascade failed after custom field update', {
      error,
      fieldId,
      organizationId,
      removed: removedKeys.length,
      relabeled: relabeledKeys.length,
    })
  }
}

/**
 * Input for updating a custom field
 */
export interface UpdateCustomFieldInput {
  resourceFieldId: ResourceFieldId
  organizationId: string
  name?: string
  description?: string
  required?: boolean
  defaultValue?: string
  /** Field options - select options, file config, flat display options
   *  (incl. CURRENCY), actor/calc bags, or `{ options, ai }` for AI-enabled selects. */
  options?: CustomFieldOptionsInput
  addressComponents?: string[]
  /** ADDRESS_STRUCT input variant: single free-text input (default, omitted
   *  from storage) vs. separate structured sub-fields. */
  inputMode?: 'single' | 'structured'
  icon?: string
  isCustom?: boolean
  active?: boolean
  position?: number
  type?: FieldType
  /** Whether this field must contain unique values within its scope */
  isUnique?: boolean
  /** Update the inverse relationship field's name (RELATIONSHIP type only) */
  inverseName?: string
}

/**
 * Update an existing custom field
 *
 * @param input - Field data to update
 * @returns Result with updated field
 */
export async function updateCustomField(input: UpdateCustomFieldInput) {
  const {
    resourceFieldId,
    organizationId,
    options,
    addressComponents,
    inputMode,
    type,
    isUnique,
    ...data
  } = input

  // Parse ResourceFieldId to get components
  const { fieldId: id } = parseResourceFieldId(resourceFieldId)

  // Get current field
  const currentResult = await fromDatabase(
    database
      .select({
        type: schema.CustomField.type,
        options: schema.CustomField.options,
        isUnique: schema.CustomField.isUnique,
        modelType: schema.CustomField.modelType,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        systemAttribute: schema.CustomField.systemAttribute,
        appInstallationId: schema.CustomField.appInstallationId,
      })
      .from(schema.CustomField)
      .where(
        and(eq(schema.CustomField.id, id), eq(schema.CustomField.organizationId, organizationId))
      )
      .limit(1),
    'get-current-field'
  )

  if (currentResult.isErr()) {
    return currentResult
  }

  const currentField = currentResult.value[0]
  if (!currentField) {
    return err({
      code: 'CUSTOM_FIELD_NOT_FOUND',
      message: 'Field not found',
      fieldId: id as string,
    } as CustomFieldNotFoundError)
  }

  // Protected fields (system + app-owned) are user-read-only at the definition
  // level. There was previously no backend guard here — the API trusted the
  // frontend and only stripped `systemAttribute` from the patch below. This
  // closes that hole and extends it to app-owned fields (only uninstall edits
  // those).
  //
  // Exception: TAGS options are user-grown data, not configuration — every
  // newly typed tag persists through this route as an options-only patch
  // (see select-input-field.tsx handleOptionsChange). Allow that patch on
  // system TAGS fields; everything else (name, type, …) stays locked, and
  // app-owned fields stay fully locked.
  if (isProtectedField(currentField)) {
    const isTagsOptionsOnlyPatch =
      !currentField.appInstallationId &&
      currentField.type === FieldTypeEnum.TAGS &&
      options !== undefined &&
      type === undefined &&
      isUnique === undefined &&
      addressComponents === undefined &&
      inputMode === undefined &&
      Object.values(data).every((v) => v === undefined)
    if (!isTagsOptionsOnlyPatch) {
      return err({
        code: 'ACCESS_DENIED' as const,
        message: currentField.appInstallationId
          ? 'This field is managed by an installed app and cannot be edited'
          : 'System fields cannot be edited',
      })
    }
  }

  const fieldType = type || currentField.type

  // Validate isUnique if being changed
  if (isUnique !== undefined) {
    // Check if field type supports uniqueness
    const relationshipType = (
      currentField.options as { relationship?: { relationshipType?: string } }
    )?.relationship?.relationshipType as 'belongs_to' | 'has_one' | 'has_many' | undefined

    if (isUnique && !canFieldBeUnique(fieldType, relationshipType)) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: `Field type ${fieldType} cannot be marked as unique`,
      })
    }

    // If enabling uniqueness, check for existing duplicates
    if (isUnique && !currentField.isUnique) {
      const hasDuplicates = await checkExistingDuplicates(
        id,
        organizationId,
        currentField.modelType,
        currentField.entityDefinitionId
      )
      if (hasDuplicates) {
        return err({
          code: 'VALIDATION_ERROR' as const,
          message: 'Cannot enable uniqueness: duplicate values exist for this field',
        })
      }
    }
  }

  // Validate options.ai (if the caller is touching it). Uses the caller's
  // new options when present, else falls back to what's already stored —
  // so re-saving a field without touching AI doesn't re-validate it.
  //
  // 🛑 A bare `SelectOption[]` is an options-ONLY patch. The record-side tag
  // picker sends exactly that on every create / rename / recolor / reorder /
  // delete, and it says nothing about AI. Reading it as "the caller omitted
  // `ai`, so clear it" silently destroyed the field's entire AI config the
  // first time anyone typed a new tag on a record — and cleared the `aiStatus`
  // marker on every one of its values on the way out. Only an object-shaped
  // patch addresses `ai`; there it stays authoritative (absent or
  // `enabled: false` both strip the marker).
  const touchesAi = options !== undefined && !Array.isArray(options)
  const incomingAi = pickAiOptions(options)
  const currentAi = (currentField.options as { ai?: AiOptions } | null | undefined)?.ai
  const effectiveAi = touchesAi ? incomingAi : currentAi
  const aiWasEnabled = currentAi?.enabled === true
  const aiWillBeEnabled = effectiveAi?.enabled === true

  // The option list the PATCH carried, kept separate from `nextSelectOptions`'
  // stored fallback: only a patch that actually addressed options may drive the
  // cascade below.
  const patchedSelectOptions = options !== undefined ? pickSelectOptions(options) : undefined
  const storedSelectOptions = (
    currentField.options as { options?: SelectOption[] } | null | undefined
  )?.options
  const nextSelectOptions = patchedSelectOptions ?? storedSelectOptions

  if (touchesAi) {
    const aiValidation = await validateAiOptions({
      organizationId,
      type: fieldType,
      ai: incomingAi,
      selectOptions: nextSelectOptions,
      selfFieldId: id,
    })
    if (aiValidation.isErr()) {
      return aiValidation
    }
  } else if (options !== undefined && aiWillBeEnabled) {
    // An options-only patch can still strand the AI config it preserves: an
    // enum-backed schema over an empty option list is unsatisfiable. Only the
    // count rule is re-checked here — the prompt was already validated when it
    // was written, and re-running the AI-sibling scan would let an unrelated
    // pre-existing conflict block someone from simply typing a tag.
    const constrained =
      fieldType === FieldTypeEnum.SINGLE_SELECT ||
      fieldType === FieldTypeEnum.MULTI_SELECT ||
      (fieldType === FieldTypeEnum.TAGS && effectiveAi?.allowNewOptions !== true)
    if (constrained && (!nextSelectOptions || nextSelectOptions.length === 0)) {
      return err({
        code: 'VALIDATION_ERROR' as const,
        message: 'AI-enabled select fields require at least one option',
      })
    }
  }

  // Build updated options
  let updatedOptions: Record<string, any> | undefined

  if (options !== undefined || addressComponents !== undefined || inputMode !== undefined) {
    let fieldOptions: Record<string, any> = {
      icon: input.icon,
      isCustom: input.isCustom,
    }

    if (currentField.options && typeof currentField.options === 'object') {
      fieldOptions = { ...currentField.options, ...fieldOptions }
    }

    if (
      fieldType === FieldTypeEnum.SINGLE_SELECT ||
      fieldType === FieldTypeEnum.MULTI_SELECT ||
      fieldType === FieldTypeEnum.TAGS
    ) {
      if (patchedSelectOptions) {
        fieldOptions.options = patchedSelectOptions
      }
    }

    if (fieldType === FieldTypeEnum.FILE) {
      if (options !== undefined && !Array.isArray(options) && 'file' in options) {
        fieldOptions.file = options.file
      }
    }

    if (fieldType === FieldTypeEnum.ACTOR) {
      if (options !== undefined && !Array.isArray(options) && 'actor' in options) {
        const actorOpts = (options as { actor: ActorOptions }).actor

        // Merge with existing actor options (allow partial updates)
        const existingActor = (currentField.options as { actor?: ActorOptions })?.actor
        fieldOptions.actor = {
          ...existingActor,
          ...actorOpts,
        }

        // Don't allow changing target or multiple in edit mode
        // (These are structural and changing them could cause data issues)
        if (existingActor) {
          fieldOptions.actor.target = existingActor.target
          fieldOptions.actor.multiple = existingActor.multiple
        }
      }
    }

    if (fieldType === FieldTypeEnum.ADDRESS_STRUCT) {
      if (addressComponents !== undefined) {
        fieldOptions.addressComponents = addressComponents
      }
      // Only persist the key for the non-default 'structured' mode — absence
      // means 'single' (decision #4, plans/address-field/01-single-input-address-field.md).
      // Explicitly clear a stale 'structured' when the caller reverts to 'single'.
      if (inputMode !== undefined) {
        if (inputMode === 'structured') {
          fieldOptions.inputMode = 'structured'
        } else {
          delete fieldOptions.inputMode
        }
      }
    }

    // Handle CALC field options. Without this branch the incoming `options.calc`
    // is dropped and the stale calc from `...currentField.options` is re-saved,
    // so expression edits silently never persist (create has this branch; update
    // was missing it).
    if (fieldType === FieldTypeEnum.CALC) {
      if (options !== undefined && !Array.isArray(options) && 'calc' in options) {
        fieldOptions.calc = (options as { calc: CalcOptions }).calc
      }
    }

    // Handle flat display options for CHECKBOX, NUMBER, DATE, DATETIME, TIME, PHONE_INTL
    if (supportsDisplayOptions(fieldType) && options !== undefined && isDisplayOptions(options)) {
      Object.assign(fieldOptions, mergeDisplayOptions(fieldType, options, {}))
    }

    // Handle options.ai: when the caller sends an object-shaped patch,
    // incomingAi is the source of truth (undefined or enabled=false both strip
    // the marker). An options-only array patch and a call that doesn't touch
    // options at all both preserve whatever was stored — see `touchesAi`.
    if (touchesAi) {
      if (incomingAi) {
        fieldOptions.ai = incomingAi
      } else {
        delete (fieldOptions as { ai?: unknown }).ai
      }
    }

    updatedOptions = fieldOptions
  }

  const updateData: Record<string, any> = { ...data }
  if (updatedOptions !== undefined) {
    updateData.options = updatedOptions
  }
  if (isUnique !== undefined) {
    updateData.isUnique = isUnique
  }

  // CRITICAL: Ensure systemAttribute is never updated
  // System attribute designation is immutable once set
  delete updateData.systemAttribute

  // Check if we need to update inverse field name (RELATIONSHIP type only)
  const relationshipConfig = currentField.options as { relationship?: RelationshipConfig }
  const inverseFieldId = relationshipConfig?.relationship
    ? getInverseFieldId(relationshipConfig.relationship)
    : null

  // If updating inverse name for a relationship field, use a transaction
  if (fieldType === FieldTypeEnum.RELATIONSHIP && input.inverseName && inverseFieldId) {
    const txResult = await fromDatabase(
      database.transaction(async (tx) => {
        // Update primary field
        const [primaryField] = await tx
          .update(schema.CustomField)
          .set(updateData)
          .where(
            and(
              eq(schema.CustomField.id, id),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )
          .returning()

        // Update inverse field name
        await tx
          .update(schema.CustomField)
          .set({ name: input.inverseName, updatedAt: new Date() })
          .where(
            and(
              eq(schema.CustomField.id, inverseFieldId),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )

        return primaryField
      }),
      'update-custom-field-with-inverse'
    )

    if (txResult.isErr()) {
      return txResult
    }

    return ok(txResult.value as CustomFieldEntity)
  }

  // Standard update (non-relationship or no inverse name change)
  const updateResult = await fromDatabase(
    database
      .update(schema.CustomField)
      .set(updateData)
      .where(
        and(eq(schema.CustomField.id, id), eq(schema.CustomField.organizationId, organizationId))
      )
      .returning(),
    'update-custom-field'
  )

  if (updateResult.isErr()) {
    return updateResult
  }

  // Toggle-off: if AI was enabled on this field and no longer is, clear the
  // aiStatus marker on all of its FieldValue rows. `valueJson` is left
  // intact — readers gate on `aiStatus IS NOT NULL`, so stale metadata
  // becomes invisible without destroying typed values that v2 types may
  // store in valueJson alongside AI metadata.
  if (aiWasEnabled && !aiWillBeEnabled) {
    await fromDatabase(
      database
        .update(schema.FieldValue)
        .set({ aiStatus: null })
        .where(
          and(
            eq(schema.FieldValue.fieldId, id),
            eq(schema.FieldValue.organizationId, organizationId)
          )
        ),
      'clear-ai-status-on-toggle-off'
    )
  }

  // Options diff. `before` MUST come from the row selected at the top of this
  // function — never from `getCachedCustomFields`: the org cache is invalidated
  // AFTER the write, so a cached before-list computes the wrong removed set and
  // deletes live values.
  if (patchedSelectOptions && isOptionBackedType(fieldType)) {
    await cascadeOptionChanges({
      organizationId,
      fieldId: id,
      entityDefinitionId: currentField.entityDefinitionId,
      before: (storedSelectOptions ?? []) as FieldOptionItem[],
      after: patchedSelectOptions as FieldOptionItem[],
    })
  }

  return ok(updateResult.value[0] as CustomFieldEntity)
}
