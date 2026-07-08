// apps/web/src/components/dashboard/ui/config/group-by-section.tsx
'use client'

// The group-by dimension controls (plan 07): a drill-down FieldPicker for the
// dimension field, plus granularity (dates only), sort, limit, and omit-empty.
// Reused for the primary group-by and the optional "Break down by" secondary
// series (bar/line), which is clearable. Group-by refs store verbatim as
// WidgetFieldRefs. Field eligibility mirrors the server's validateGroupBy.

import { FieldType } from '@auxx/database/enums'
import type { DateGranularity, GroupBy, GroupSort, WidgetSource } from '@auxx/lib/dashboards/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { useField } from '~/components/resources/hooks/use-field'
import { effectiveFieldTypeOf, isRelationshipField } from '../../lib/field-meta'
import { isGroupableFieldType, supportsDateGranularity } from '../../lib/metric-ops'
import { ConfigFieldRow } from './config-field-row'
import { FieldRefRow } from './field-ref-picker'

const GRANULARITY_OPTIONS: SelectOption[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'dayOfWeek', label: 'Day of week' },
  { value: 'monthOfYear', label: 'Month of year' },
]

const SORT_OPTIONS: SelectOption[] = [
  { value: 'valueDesc', label: 'Value (high → low)' },
  { value: 'valueAsc', label: 'Value (low → high)' },
  { value: 'labelAsc', label: 'Label (A → Z)' },
  { value: 'labelDesc', label: 'Label (Z → A)' },
]

const leaf = (ref: GroupBy['fieldRef']): ResourceFieldId =>
  isFieldPath(ref) ? ref[ref.length - 1] : ref

export function GroupBySection({
  source,
  label,
  groupBy,
  onChange,
  isRequired,
  allowClear,
}: {
  source: WidgetSource
  label: string
  groupBy: GroupBy | undefined
  onChange: (groupBy: GroupBy | undefined) => void
  isRequired?: boolean
  allowClear?: boolean
}) {
  const field = useField(groupBy?.fieldRef ? leaf(groupBy.fieldRef) : null)
  const fieldType = field ? effectiveFieldTypeOf(field) : undefined
  const showGranularity = supportsDateGranularity(fieldType)

  const patch = (p: Partial<GroupBy>) => {
    if (!groupBy) return
    onChange({ ...groupBy, ...p })
  }

  return (
    <>
      <FieldRefRow
        title={label}
        isRequired={isRequired}
        source={source}
        value={groupBy?.fieldRef}
        filterField={(f) => isRelationshipField(f) || isGroupableFieldType(effectiveFieldTypeOf(f))}
        onChange={(ref) => onChange({ ...groupBy, fieldRef: ref })}
        onClear={allowClear ? () => onChange(undefined) : undefined}
      />

      {groupBy?.fieldRef && (
        <>
          {showGranularity && (
            <ConfigFieldRow
              title='Granularity'
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: GRANULARITY_OPTIONS }}
              value={groupBy.dateGranularity ?? 'day'}
              onChange={(v) => patch({ dateGranularity: v as DateGranularity })}
            />
          )}
          <ConfigFieldRow
            title='Sort'
            fieldType={FieldType.SINGLE_SELECT}
            fieldOptions={{ options: SORT_OPTIONS }}
            value={groupBy.sort ?? 'valueDesc'}
            onChange={(v) => patch({ sort: v as GroupSort })}
          />
          <ConfigFieldRow
            title='Limit'
            fieldType={FieldType.NUMBER}
            value={groupBy.limit}
            onChange={(v) => patch({ limit: v as number | undefined })}
            placeholder='50'
          />
          <ConfigFieldRow
            title='Omit empty'
            description='Hide the no-value group'
            fieldType={FieldType.CHECKBOX}
            fieldOptions={{ variant: 'switch' }}
            value={groupBy.omitEmpty ?? false}
            onChange={(v) => patch({ omitEmpty: Boolean(v) })}
          />
        </>
      )}
    </>
  )
}
