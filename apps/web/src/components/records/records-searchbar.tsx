// apps/web/src/components/records/records-searchbar.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import type { Operator } from '@auxx/lib/conditions/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import { useCallback, useEffect, useMemo } from 'react'
import { ConditionProvider } from '~/components/conditions/condition-context'
import type { FieldDefinition } from '~/components/conditions/types'
import { getDefaultOperatorForType } from '~/components/conditions/utils'
import { SearchBarShell } from '~/components/searchbar/searchbar-shell'
import type { SearchFieldDefinition, SearchSuggestion } from '~/components/searchbar/types'
import {
  RECORDS_FREE_TEXT_FIELD,
  selectDisplayText,
  selectHasActiveConditions,
  useRecordsSearchActions,
  useRecordsSearchStore,
} from './records-search-store'

interface RecordsSearchBarProps {
  entityDefinitionId: string
  fields: ResourceField[]
}

/** Convert ResourceField[] to SearchFieldDefinition[] for suggestions */
function toSearchFields(fields: ResourceField[]): SearchFieldDefinition[] {
  return fields
    .filter(
      (f) => f.capabilities.filterable && !f.capabilities.hidden && f.id !== RECORDS_FREE_TEXT_FIELD
    )
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      description: f.description,
    }))
}

/**
 * Synthetic field definition backing the free-text chip.
 *
 * It exists so the typed text renders and edits like every other chip; it is
 * NOT a filter. `RecordsView` pulls this condition back out via
 * `splitRecordSearch` and sends it as `record.listFiltered`'s `search` param,
 * which is what reaches the ranked predicate instead of `ILIKE '%q%'`.
 */
const DISPLAY_NAME_FIELD: FieldDefinition = {
  id: RECORDS_FREE_TEXT_FIELD,
  label: 'Name',
  type: BaseType.STRING,
  fieldType: 'TEXT' as FieldType,
}

/** Convert ResourceField[] to FieldDefinition[] for ConditionProvider */
function toConditionFields(fields: ResourceField[]): FieldDefinition[] {
  const mapped = fields
    .filter((f) => f.capabilities.filterable && !f.capabilities.hidden)
    .map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      fieldType: f.fieldType,
      options: f.options,
      operators: f.operators as Operator[] | undefined,
    }))

  // Ensure the free-text field is always present so the typed chip renders
  if (!mapped.some((f) => f.id === RECORDS_FREE_TEXT_FIELD)) {
    mapped.unshift(DISPLAY_NAME_FIELD)
  }

  return mapped
}

/** Build suggestions from search fields, optionally filtered by query */
function buildSuggestions(fields: SearchFieldDefinition[], query: string): SearchSuggestion[] {
  if (!query) {
    return fields.map((f) => ({
      type: 'field',
      fieldId: f.id,
      fieldDefinition: f,
      value: f.id,
      label: f.label,
      description: f.description,
    }))
  }

  const lower = query.toLowerCase()
  return fields
    .filter((f) => f.label.toLowerCase().includes(lower) || f.id.toLowerCase().includes(lower))
    .map((f) => ({
      type: 'field',
      fieldId: f.id,
      fieldDefinition: f,
      value: f.id,
      label: f.label,
      description: f.description,
    }))
}

/**
 * RecordsSearchBar — thin wrapper around SearchBarShell for entity records.
 * Converts search conditions to ConditionGroup[] that merge with view filters.
 */
export function RecordsSearchBar({ entityDefinitionId, fields }: RecordsSearchBarProps) {
  const conditions = useRecordsSearchStore((s) => s.conditions)
  const highlightedIndex = useRecordsSearchStore((s) => s.highlightedIndex)
  const hasActiveConditions = useRecordsSearchStore(selectHasActiveConditions)
  const displayText = useRecordsSearchStore(selectDisplayText)
  const actions = useRecordsSearchActions()

  const searchFields = useMemo(() => toSearchFields(fields), [fields])
  const conditionFields = useMemo(() => toConditionFields(fields), [fields])

  // Reset conditions when switching between entity types
  useEffect(() => {
    useRecordsSearchStore.getState().setContext(entityDefinitionId)
  }, [entityDefinitionId])

  const handleSuggestionSelect = useCallback(
    (suggestion: SearchSuggestion) => {
      if (suggestion.type === 'field' && suggestion.fieldId) {
        const field = fields.find((f) => f.id === suggestion.fieldId)
        const defaultOp = field
          ? (getDefaultOperatorForType(field.type) as Operator)
          : ('contains' as Operator)
        actions.addCondition(suggestion.fieldId, defaultOp, undefined)
      }
    },
    [actions, fields]
  )

  const handleConditionsChange = useCallback(
    (newConditions: any[]) => {
      actions.setConditions(
        newConditions.map((c) => ({
          id: c.id,
          fieldId: c.fieldId,
          operator: c.operator,
          value: c.value,
          displayLabel: c.displayLabel,
        }))
      )
    },
    [actions]
  )

  // Suggestions are built client-side from entity fields (no tRPC needed)
  const suggestions = useMemo(() => buildSuggestions(searchFields, ''), [searchFields])

  return (
    <ConditionProvider
      conditions={conditions}
      config={{
        mode: 'resource',
        fields: conditionFields,
        compactMode: true,
        entityDefinitionId,
      }}
      getFieldDefinition={(fieldId) => {
        const id = Array.isArray(fieldId) ? fieldId[0] : fieldId
        return conditionFields.find((f) => f.id === id)
      }}
      onConditionsChange={handleConditionsChange}>
      <SearchBarShell
        conditions={conditions}
        actions={actions}
        highlightedIndex={highlightedIndex}
        hasActiveConditions={hasActiveConditions}
        displayText={displayText}
        suggestions={suggestions}
        onSuggestionSelect={handleSuggestionSelect}
        onSearch={() => {}}
        freeTextField={RECORDS_FREE_TEXT_FIELD}
        freeTextOperator={'contains' as Operator}
        placeholder='Search records...'
        showFilterButton={false}
        className='flex-1 min-w-0'
      />
    </ConditionProvider>
  )
}
