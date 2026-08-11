// apps/web/src/components/records/hooks/use-record-display-fields.ts
'use client'

import {
  type FieldOptions,
  formatToDisplayValue,
  parseRecordId,
  type RecordId,
} from '@auxx/lib/field-values/client'
import { toFieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { useMemo } from 'react'
import { toPanelField } from '~/components/fields/rows/to-panel-field'
import type { PanelField } from '~/components/fields/rows/types'
import { useRecord, useResource, useResourceFields } from '~/components/resources'
import { useFieldValue } from '~/components/resources/hooks/use-field-values'

/** The avatar slot, resolved against the resource's configured avatar field. */
interface RecordAvatarConfig {
  /** Visual ref stored on the instance (image, emoji, colour, icon id). */
  avatarUrl: string | null
  /** Resource icon id, the fallback when `avatarUrl` is empty. */
  iconId: string
  /** Resource colour, paired with `iconId`. */
  color: string
  /**
   * Set only when the avatar is click-to-upload: the resource configures a
   * `FILE` avatar field AND the surface is not read-only. `RecordIcon` renders
   * the same visual when this is null.
   */
  upload: { fieldId: string; options?: FieldOptions } | null
}

export interface RecordDisplayFields {
  /** Resolved resource, or undefined until the resource store hydrates. */
  resource: ReturnType<typeof useResource>['resource']
  /** The cached record row, or undefined until the batch fetcher resolves it. */
  record: Record<string, unknown> | undefined
  /** True while the record row itself is in flight. */
  isRecordLoading: boolean
  avatar: RecordAvatarConfig
  /** Primary display field folded to a `PanelField`, or null when unconfigured. */
  primaryField: PanelField | null
  /** Secondary display field folded to a `PanelField`, or null when unconfigured. */
  secondaryField: PanelField | null
  /** Field value when hydrated, else the record row's `displayName`. */
  displayName: string | null
  /** Field value when hydrated, else the record row's `secondaryDisplayValue`. */
  secondaryDisplay: string | null
  /** Raw record-store `displayName`, the fallback while a field value loads. */
  displayNameFallback: string | null
  /** Raw record-store `secondaryDisplayValue`, same role for the second line. */
  secondaryDisplayFallback: string | null
  /**
   * Whether the primary field's value has landed in the field-value store.
   * `undefined` in the store means "never fetched", which is a different state
   * from "fetched and empty" — the header needs the distinction to tell a
   * loading window (show the row fallback) from a genuinely blank value (show
   * the editable placeholder).
   */
  primaryHydrated: boolean
  /** Same signal for the secondary field. */
  secondaryHydrated: boolean
}

/**
 * Resolves everything the record identity header renders: the avatar slot, the
 * primary/secondary display fields as editable `PanelField`s, and their current
 * display strings.
 *
 * The display strings prefer the live field value (so an edit anywhere shows up
 * here immediately) and fall back to the record row's denormalized
 * `displayName` / `secondaryDisplayValue`. **Both halves matter**: the field
 * value is authoritative once hydrated, and the row value is what keeps the
 * header from flashing a placeholder in the window before it hydrates.
 *
 * Subscribes without `autoFetch` — the header's `PropertyProvider`s fetch the
 * values they render, and every other caller here only wants what is already
 * cached.
 */
export function useRecordDisplayFields(
  recordId: RecordId | null | undefined,
  readOnly = false
): RecordDisplayFields {
  const entityDefinitionId = recordId ? parseRecordId(recordId).entityDefinitionId : ''

  const { resource } = useResource(entityDefinitionId || null)
  const { fields } = useResourceFields(entityDefinitionId || null)
  const { record, isLoading: isRecordLoading } = useRecord({
    recordId: recordId ?? null,
    enabled: !!recordId,
  })

  const primaryDisplayFieldId = resource?.display.primaryDisplayField?.id ?? null
  const secondaryDisplayFieldId = resource?.display.secondaryDisplayField?.id ?? null
  const avatarFieldId = resource?.display.avatarField?.id ?? null

  /** Resolve a display-field id against the (optimistically overlaid) field list. */
  const findField = useMemo(() => {
    return (fieldId: string | null) =>
      fieldId ? (fields.find((f) => (f.id || f.key) === fieldId) ?? null) : null
  }, [fields])

  const primaryResourceField = findField(primaryDisplayFieldId)
  const secondaryResourceField = findField(secondaryDisplayFieldId)
  const avatarResourceField = findField(avatarFieldId)

  const primaryField = useMemo(
    () => (primaryResourceField ? toPanelField(primaryResourceField, readOnly) : null),
    [primaryResourceField, readOnly]
  )
  const secondaryField = useMemo(
    () => (secondaryResourceField ? toPanelField(secondaryResourceField, readOnly) : null),
    [secondaryResourceField, readOnly]
  )

  // Reactive value subscriptions — these are what make an edit made elsewhere
  // (table cell, Details panel, another tab via realtime) repaint the header.
  const primaryFieldValue = useFieldValue(
    recordId ?? ('' as RecordId),
    primaryDisplayFieldId ? toFieldId(primaryDisplayFieldId) : undefined
  )
  const secondaryFieldValue = useFieldValue(
    recordId ?? ('' as RecordId),
    secondaryDisplayFieldId ? toFieldId(secondaryDisplayFieldId) : undefined
  )

  const displayNameFallback = (record?.displayName as string | null | undefined) ?? null
  const secondaryDisplayFallback =
    (record?.secondaryDisplayValue as string | null | undefined) ?? null

  const displayName = useMemo(() => {
    if (!recordId || !primaryDisplayFieldId) return displayNameFallback
    if (primaryFieldValue.value && primaryField?.fieldType) {
      // The store types values as `unknown` because optimistic writes can hold a
      // raw value briefly; everything hydrated/confirmed is a TypedFieldValue.
      return String(
        formatToDisplayValue(primaryFieldValue.value as TypedFieldValue, primaryField.fieldType)
      )
    }
    return displayNameFallback
  }, [
    recordId,
    primaryDisplayFieldId,
    primaryFieldValue.value,
    primaryField?.fieldType,
    displayNameFallback,
  ])

  const secondaryDisplay = useMemo(() => {
    if (!recordId || !secondaryDisplayFieldId) return secondaryDisplayFallback
    if (secondaryFieldValue.value && secondaryField?.fieldType) {
      return String(
        formatToDisplayValue(secondaryFieldValue.value as TypedFieldValue, secondaryField.fieldType)
      )
    }
    return secondaryDisplayFallback
  }, [
    recordId,
    secondaryDisplayFieldId,
    secondaryFieldValue.value,
    secondaryField?.fieldType,
    secondaryDisplayFallback,
  ])

  const avatar = useMemo<RecordAvatarConfig>(
    () => ({
      avatarUrl: (record?.avatarUrl as string | null | undefined) ?? null,
      iconId: resource?.icon || 'circle',
      color: resource?.color || 'gray',
      // Upload writes a field value, so it needs a real FILE field to write to —
      // and the same read-only answer every other write affordance obeys.
      upload:
        avatarResourceField && avatarResourceField.fieldType === 'FILE' && !readOnly
          ? {
              fieldId: avatarResourceField.id || avatarResourceField.key,
              options: avatarResourceField.options,
            }
          : null,
    }),
    [record?.avatarUrl, resource?.icon, resource?.color, avatarResourceField, readOnly]
  )

  return {
    resource,
    record: record as Record<string, unknown> | undefined,
    isRecordLoading,
    avatar,
    primaryField,
    secondaryField,
    displayName,
    secondaryDisplay,
    displayNameFallback,
    secondaryDisplayFallback,
    primaryHydrated: primaryFieldValue.value !== undefined,
    secondaryHydrated: secondaryFieldValue.value !== undefined,
  }
}
