// apps/web/src/components/data-import/value-review/editing-input.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { isOptionResolutionType } from '@auxx/lib/import/client'
import { getFieldOutputKey } from '@auxx/lib/resources/client'
import { Input } from '@auxx/ui/components/input'
import { minorToMajorString, parseMajorToMinor } from '@auxx/utils/currency'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useResourceFields } from '~/components/resources'
import type { ColumnFieldConfig, OverrideValue, ResolutionStatus } from '../types'

export interface EditingInputProps {
  fieldConfig: ColumnFieldConfig | null
  rawValue: string
  resolvedValue: string | null
  originalStatus: ResolutionStatus
  isOverridden: boolean
  overrideValues: OverrideValue[] | null
  onSave: (overrideValues: OverrideValue[] | null) => void
}

/** Compare two option-key sets order-insensitively. */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((key, i) => key === sortedB[i])
}

/** A resolved or overridden minor-unit amount as a number, or undefined when there is none. */
function readMinorUnits(text: string | null | undefined): number | undefined {
  if (text === null || text === undefined || text.trim() === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Component for editing value overrides.
 *
 * Option columns (`select:*` / `multiselect:*`) render the real select picker
 * via `FieldInputAdapter`, showing labels (`TagsView` chips inside the trigger)
 * instead of raw option keys. Money columns (a CURRENCY target field) render
 * the currency input: the resolver's answer is MINOR units, and `1594` in a
 * text box beside a cell reading `15.94` looks like a hundredfold error, while
 * a rate resolved to `1.594` looks like a wrong one. Everything else renders a
 * text input that saves on blur.
 */
export function EditingInput({
  fieldConfig,
  rawValue,
  resolvedValue,
  originalStatus,
  isOverridden,
  overrideValues,
  onSave,
}: EditingInputProps) {
  // Check if currently skipped (skipped rows don't render this component, but
  // the derivations below must not read a skip marker as a value)
  const isSkipped = isOverridden && overrideValues?.[0]?.type === 'skip'

  const resolutionType = fieldConfig?.resolutionType ?? 'text:value'
  const isOptionColumn = isOptionResolutionType(resolutionType)

  // The field's REAL type (SINGLE_SELECT vs MULTI_SELECT vs TAGS — they differ
  // on multi/canAdd). Resolved from the resource store by output key; the
  // resolution-type prefix is only a fallback for a cold store or a vanished
  // field. `useFieldByKey` is deliberately not used — its custom-field arm
  // expects the CustomField UUID, not the output key.
  const { fields } = useResourceFields(
    isOptionColumn ? (fieldConfig?.entityDefinitionId ?? null) : null
  )
  const storeField = useMemo(() => {
    if (!isOptionColumn || !fieldConfig) return undefined
    return fields.find((f) => getFieldOutputKey(f) === fieldConfig.key)
  }, [fields, fieldConfig, isOptionColumn])
  const optionFieldType =
    storeField?.fieldType ??
    (resolutionType.startsWith('multiselect:') ? FieldType.MULTI_SELECT : FieldType.SINGLE_SELECT)

  // The resolver's answer as option key(s). Multiselect values arrive
  // comma-joined (option keys never contain commas); a pending option CREATE
  // resolves to the label to be minted, not a key, so it contributes none.
  const autoKeys = useMemo(() => {
    if (!isOptionColumn || originalStatus === 'create' || !resolvedValue) return []
    return resolvedValue.split(',').filter(Boolean)
  }, [isOptionColumn, originalStatus, resolvedValue])

  /** Current selection: the override when present, else the resolver's answer. */
  const selectedKeys = useMemo(() => {
    if (isOverridden && !isSkipped && overrideValues) {
      return overrideValues
        .filter((ov) => ov.type !== 'skip')
        .map((ov) => ov.value)
        .filter(Boolean)
    }
    return autoKeys
  }, [isOverridden, isSkipped, overrideValues, autoKeys])

  // ── Text editor state ──────────────────────────────────────────────
  // Never seeded with `resolvedValue` for option columns: those render the
  // picker below and a 21-char option key must never appear in a textbox.
  const initialValue = useMemo(() => {
    if (isSkipped) {
      return resolvedValue ?? rawValue
    }
    if (isOverridden && overrideValues?.[0]) {
      return overrideValues[0].value
    }
    return resolvedValue ?? rawValue
  }, [isOverridden, isSkipped, overrideValues, resolvedValue, rawValue])

  const [editValue, setEditValue] = useState(initialValue)

  // Rows are recycled by `hash` in the virtual list and props move under
  // Revert / re-resolve without a remount — resync the draft when the
  // incoming value changes.
  useEffect(() => {
    setEditValue(initialValue)
  }, [initialValue])

  /** The original (non-overridden) value */
  const originalValue = resolvedValue ?? rawValue

  /** Handle text input blur - save the value */
  const handleTextBlur = () => {
    // No change from current state
    if (editValue === initialValue) {
      return
    }
    // Changed back to original - trigger revert
    if (editValue === originalValue) {
      onSave(null)
      return
    }
    // Save as override
    onSave([{ type: 'value', value: editValue }])
  }

  /**
   * Option selection change — saves immediately with the FULL key array
   * (single select writes one key, multi writes all). Re-picking exactly the
   * resolver's answer reverts to it; clearing the selection (the trigger's ×,
   * or unchecking the last option) skips the value — "import nothing for this
   * cell", the same override the row's skip button writes. The old empty-case
   * only acted when already overridden, so clearing a resolver-matched value
   * silently did nothing.
   */
  const handleOptionChange = (next: unknown) => {
    const keys = Array.isArray(next)
      ? (next as string[]).filter(Boolean)
      : typeof next === 'string' && next
        ? [next]
        : []

    if (keys.length === 0) {
      // Nothing was selected and nothing is cleared — a no-op, not a skip.
      if (autoKeys.length === 0 && !isOverridden) return
      onSave([{ type: 'skip', value: '' }])
      return
    }
    if (sameKeys(keys, autoKeys)) {
      if (isOverridden) onSave(null)
      return
    }
    onSave(keys.map((value) => ({ type: 'value' as const, value })))
  }

  // ── Money editor ───────────────────────────────────────────────────
  // The input works in minor units (what the resolver produced). What is
  // SAVED is text the column's own resolver reads back: a major-unit string
  // for `currency:major` (`1.594` → `0.01594`, at the field's precision), the
  // minor-unit number itself for a column read as raw cents. The server
  // re-resolves the override either way, so the two stay one contract.
  const isMoneyColumn = fieldConfig?.type === 'currency' && !!fieldConfig.currencyCode
  const currencyCode = fieldConfig?.currencyCode ?? 'USD'
  const decimals = fieldConfig?.decimals
  const toOverrideText = (minor: number): string =>
    resolutionType === 'number:integer'
      ? String(minor)
      : minorToMajorString(minor, currencyCode, decimals)

  // The EFFECTIVE minor-unit amount. An override is what the row displays
  // (the optimistic cache patch writes `overrideValues`, not `resolvedValue`),
  // so it is read back through the same conversion that produced it; otherwise
  // `resolvedValue` is the resolver's answer. An unreadable cell has neither,
  // and its raw text must never be read as minor units.
  const overrideText = isOverridden && !isSkipped ? overrideValues?.[0]?.value : undefined
  const moneyValue =
    overrideText === undefined
      ? readMinorUnits(resolvedValue)
      : overrideText.trim() === ''
        ? undefined
        : resolutionType === 'number:integer'
          ? readMinorUnits(overrideText)
          : (parseMajorToMinor(overrideText, currencyCode, decimals) ?? undefined)

  const handleMoneyChange = (next: unknown) => {
    const minor = typeof next === 'number' && Number.isFinite(next) ? next : undefined

    if (minor === undefined) {
      // Cleared. Same override the text editor writes for an emptied cell: a
      // blank the resolver reads as "import nothing".
      if (moneyValue === undefined) return
      onSave([{ type: 'value', value: '' }])
      return
    }
    if (minor === moneyValue) return
    onSave([{ type: 'value', value: toOverrideText(minor) }])
  }

  if (isMoneyColumn && fieldConfig) {
    const value = moneyValue
    return (
      <div className='min-w-0 flex-1' title={rawValue}>
        <FieldInputAdapter
          fieldType={FieldType.CURRENCY}
          fieldOptions={{ currencyCode, decimals }}
          value={value ?? null}
          onChange={handleMoneyChange}
          // An unreadable cell has no resolved value; the cell text is the
          // hint for what to type.
          placeholder={value === undefined ? rawValue : undefined}
          triggerProps={{ className: 'h-7' }}
        />
      </div>
    )
  }

  // Option columns always render the picker — even with an empty live list —
  // so a raw option key never leaks into a text input.
  if (isOptionColumn && fieldConfig) {
    return (
      <div className='min-w-0 flex-1' title={rawValue}>
        <FieldInputAdapter
          fieldType={optionFieldType}
          fieldOptions={{ options: fieldConfig.options ?? [] }}
          value={selectedKeys}
          onChange={handleOptionChange}
          placeholder='Select value...'
          // Overrides must reference existing option keys; minting happens via
          // the import's own select-create path, so the picker never creates —
          // and never manages (renaming/deleting an option here would edit the
          // org-wide taxonomy from an import screen).
          canAdd={false}
          canManage={false}
          // No trigger ×: skipping a value has its own row control; deselecting
          // everything in the picker still skips.
          triggerProps={{ className: 'h-7', showClear: false }}
        />
      </div>
    )
  }

  // Default text input for all other types
  return (
    <Input
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      className='h-7'
      variant='transparent'
      size='sm'
      onBlur={handleTextBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur() // Trigger blur to save
        }
      }}
    />
  )
}
