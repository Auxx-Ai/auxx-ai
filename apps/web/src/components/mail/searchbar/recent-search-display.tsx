// apps/web/src/components/mail/searchbar/recent-search-display.tsx

'use client'

import { getMailViewFieldDefinition, SEARCH_SCOPE_FIELD_ID } from '@auxx/lib/mail-views/client'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import type { ActorId } from '@auxx/types/actor'
import type { RecordId } from '@auxx/types/resource'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import type { SearchCondition } from '~/components/searchbar/types'
import { ItemsListView } from '~/components/ui/items-list-view'

interface RecentSearchDisplayProps {
  conditions: SearchCondition[]
}

export function RecentSearchDisplay({ conditions }: RecentSearchDisplayProps) {
  const displayConditions = conditions.filter((c) => c.fieldId !== SEARCH_SCOPE_FIELD_ID)

  if (displayConditions.length === 0) return null

  return (
    <div className='flex items-center gap-1 flex-wrap'>
      {displayConditions.map((condition) => (
        <ConditionValueDisplay key={condition.id} condition={condition} />
      ))}
    </div>
  )
}

function ConditionValueDisplay({ condition }: { condition: SearchCondition }) {
  // Free text conditions display as quoted text
  if (condition.fieldId === 'freeText') {
    return (
      <span className='text-xs text-primary-600 bg-primary-100 rounded-md px-1.5 py-0.5'>
        &ldquo;{String(condition.value)}&rdquo;
      </span>
    )
  }

  const fieldDef = getMailViewFieldDefinition(condition.fieldId)
  const fieldLabel = fieldDef?.label ?? condition.fieldId
  const baseType = fieldDef?.type

  // For operators that don't need a value (isEmpty, isNotEmpty, etc.)
  if (condition.value === undefined || condition.value === null) {
    return <ConditionChip label={fieldLabel} value={condition.operator} />
  }

  switch (baseType) {
    case BaseType.ACTOR:
      return renderActorValue(fieldLabel, condition.value)
    case BaseType.RELATION:
      return renderRelationValue(fieldLabel, condition.value)
    case BaseType.ENUM:
      return renderEnumValue(fieldLabel, condition.value, fieldDef)
    default:
      return (
        <ConditionChip
          label={fieldLabel}
          value={condition.displayLabel || String(condition.value)}
        />
      )
  }
}

function ConditionChip({ label, value }: { label: string; value: string }) {
  return (
    <span className='inline-flex items-center gap-1 text-xs text-primary-600 bg-primary-100 rounded-md px-1.5 py-0.5'>
      <span className='text-primary-400'>{label}:</span>
      <span className='truncate max-w-[120px]'>{value}</span>
    </span>
  )
}

function renderActorValue(fieldLabel: string, value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) return null

  return (
    <div className='flex items-center gap-1'>
      <span className='text-xs text-primary-400'>{fieldLabel}:</span>
      <ItemsListView
        className='w-auto'
        items={values as string[]}
        renderItem={(actorId) => <ActorBadge actorId={actorId as ActorId} size='sm' />}
        maxDisplay={3}
      />
    </div>
  )
}

function renderRelationValue(fieldLabel: string, value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  if (values.length === 0) return null

  return (
    <div className='flex items-center gap-1'>
      <span className='text-xs text-primary-400'>{fieldLabel}:</span>
      <ItemsListView
        className='w-auto'
        items={values as string[]}
        renderItem={(recordId) => (
          <RecordBadge recordId={recordId as RecordId} showIcon variant='default' size='sm' />
        )}
        maxDisplay={3}
      />
    </div>
  )
}

function renderEnumValue(
  fieldLabel: string,
  value: unknown,
  fieldDef: ReturnType<typeof getMailViewFieldDefinition>
) {
  const options = fieldDef?.options?.options
  const matchedLabel = options?.find(
    (opt: { value: string; label: string }) => opt.value === value
  )?.label
  return <ConditionChip label={fieldLabel} value={matchedLabel ?? String(value)} />
}
