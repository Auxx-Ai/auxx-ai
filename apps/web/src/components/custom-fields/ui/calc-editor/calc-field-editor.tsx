// apps/web/src/components/custom-fields/ui/calc-editor/calc-field-editor.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import { CommandNavigation } from '@auxx/ui/components/command'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useCallback, useMemo } from 'react'
import {
  CalcFormulaInput,
  type CalcTokenSource,
  CalcTokensUsed,
  extractFieldIdsFromString,
  FunctionsPickerGroup,
} from '~/components/global/calc-formula'
import {
  FieldPickerInnerContent,
  type FieldPickerNavigationItem,
} from '~/components/pickers/field-picker'
import { FieldBadge } from '~/components/resources/ui'

/** Options for a CALC field stored in field.options.calc */
export interface CalcEditorOptions {
  expression: string
  sourceFields: Record<string, string> // Record<placeholderKey, FieldId>
  resultFieldType: FieldTypeType
  disabled?: boolean
  disabledReason?: string
}

/** Props for CalcFieldEditor */
interface CalcFieldEditorProps {
  /** Current calc options */
  options: CalcEditorOptions
  /** Callback when options change */
  onChange: (options: CalcEditorOptions) => void
  /** Entity definition ID for field picker */
  entityDefinitionId: string
  /** Current field ID to exclude from picker (prevent self-reference) */
  currentFieldId?: string
  /** Available fields to reference in the expression (for display and validation) */
  availableFields: Array<{ key: string; label: string; type: string; id: string }>
}

/**
 * Editor component for CALC field configuration. A thin wrapper over the shared
 * {@link CalcFormulaInput}: its token source is the entity definition's fields
 * (badge = {@link FieldBadge}, picker = {@link FieldPickerInnerContent}). Adds
 * the custom-field-only "Result Format" selector and stores `sourceFields` as
 * `placeholderKey → field UUID`.
 */
export function CalcFieldEditor({
  options,
  onChange,
  entityDefinitionId,
  currentFieldId,
  availableFields,
}: CalcFieldEditorProps) {
  // Build a mapping from field key to field id for storage
  const fieldKeyToId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of availableFields) {
      map[f.key] = f.id
    }
    return map
  }, [availableFields])

  // Build exclude filters: exclude RELATIONSHIP and CALC types, plus current field
  const excludeFilters = useMemo(() => {
    const filters: ((typeof FieldType)[keyof typeof FieldType] | string)[] = [
      FieldType.RELATIONSHIP,
      FieldType.CALC,
    ]
    if (currentFieldId) {
      filters.push(`${entityDefinitionId}:${currentFieldId}`)
    }
    return filters
  }, [entityDefinitionId, currentFieldId])

  /** Handle selecting a field from the picker */
  const handleSelectField = useCallback(
    (onSelect: (tokenId: string) => void) => (_ref: FieldReference, field: ResourceField) => {
      // Insert the field's `key` (e.g. `lastName`) — the token the FieldBadge
      // pill resolves (fieldMap aliases `<entity>:<key>`) and what
      // `availableFields` / `fieldKeyToId` are keyed by. The output key
      // (`systemAttribute`, e.g. `last_name`) is NOT fieldMap-resolvable.
      onSelect(field.key || field.id)
    },
    []
  )

  // The token source: entity fields. Badge resolves a key against the resource
  // store; the picker is the self-contained field navigation widget, with the
  // shared functions group nested via its `renderAdditionalContent` slot.
  const tokenSource: CalcTokenSource = useMemo(
    () => ({
      renderBadge: (id, selected) => (
        <FieldBadge id={id} entityDefinitionId={entityDefinitionId} selected={selected} />
      ),
      renderPickerItems: ({ onSelect, insertFunction, onClose }) => (
        <CommandNavigation<FieldPickerNavigationItem>>
          <FieldPickerInnerContent
            entityDefinitionId={entityDefinitionId}
            excludeFields={excludeFilters}
            onSelect={handleSelectField(onSelect)}
            onClose={onClose}
            closeOnSelect
            showBreadcrumb={false}
            searchPlaceholder='Search fields or functions...'
            renderAdditionalContent={(search) => (
              <FunctionsPickerGroup search={search} onSelect={insertFunction} />
            )}
          />
        </CommandNavigation>
      ),
    }),
    [entityDefinitionId, excludeFilters, handleSelectField]
  )

  // Build sourceFields mapping: placeholder key → bare field id (UUID). Both
  // calc consumers — the client `calc-value-computer` dependency graph and the
  // server `calc-resolver` (which wraps with `toResourceFieldId`) — expect a
  // plain field id, NOT a `entityDef:fieldId` ResourceFieldId.
  const handleExpressionChange = useCallback(
    (expression: string, extractedTokens: string[]) => {
      const sourceFieldsMap: Record<string, string> = {}
      for (const key of extractedTokens) {
        if (fieldKeyToId[key]) {
          sourceFieldsMap[key] = fieldKeyToId[key]
        }
      }
      onChange({ ...options, expression, sourceFields: sourceFieldsMap })
    },
    [fieldKeyToId, onChange, options]
  )

  // Tokens currently referenced, for the "Fields used" strip.
  const usedTokens = useMemo(
    () => extractFieldIdsFromString(options.expression),
    [options.expression]
  )

  return (
    <FieldGroup className='space-y-4'>
      <CalcFormulaInput
        expression={options.expression}
        onChange={handleExpressionChange}
        tokenSource={tokenSource}
        label='Formula Expression'
        showFunctionsHelp
        placeholder='Type { to insert a field, e.g., concat({firstName}, " ", {lastName})'
      />

      <CalcTokensUsed tokens={usedTokens} tokenSource={tokenSource} />

      {/* Result Field Type */}
      <Field>
        <FieldLabel>Result Format</FieldLabel>
        <Select
          value={options.resultFieldType}
          onValueChange={(value: FieldTypeType) =>
            onChange({ ...options, resultFieldType: value })
          }>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='TEXT'>Text</SelectItem>
            <SelectItem value='NUMBER'>Number</SelectItem>
            <SelectItem value='CURRENCY'>Currency</SelectItem>
            <SelectItem value='CHECKBOX'>Yes/No</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>
          How the calculated result should be formatted for display
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}

/** Parse CalcEditorOptions from field options */
export function parseCalcOptions(fieldOptions?: Record<string, unknown>): CalcEditorOptions {
  const calc = fieldOptions?.calc as Partial<CalcEditorOptions> | undefined
  return {
    expression: calc?.expression ?? '',
    sourceFields: calc?.sourceFields ?? {},
    resultFieldType: (calc?.resultFieldType as FieldTypeType) ?? 'TEXT',
    disabled: calc?.disabled,
    disabledReason: calc?.disabledReason,
  }
}

/** Format CalcEditorOptions for storage in field.options */
export function formatCalcOptions(options: CalcEditorOptions): { calc: CalcEditorOptions } {
  return { calc: options }
}
