// apps/web/src/components/kopilot/ui/blocks/kopilot-field-row.tsx

'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { EntityIcon } from '@auxx/ui/components/icons'
import { FieldDisplay } from '~/components/fields'
import { useFieldByKey } from '~/components/resources'

/** camelCase / snake_case → "Title Case" for unknown keys */
function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

interface KopilotFieldRowProps {
  entityDefinitionId: string | null
  fieldKey: string
  value: unknown
}

/**
 * Renders a `icon | label | value` row for a kopilot approval card.
 * Resolves the ResourceField from the LLM's key (systemAttribute or CustomField UUID)
 * via `useFieldByKey`, then hands off to `FieldDisplay` so relationships hydrate,
 * enums render as pills, dates format, etc. — all via the shared display stack.
 *
 * Layout mirrors `PropertyRow` (icon + fixed-width label + value) so the approval
 * card matches the entity-fields panel visually.
 */
export function KopilotFieldRow({ entityDefinitionId, fieldKey, value }: KopilotFieldRowProps) {
  const field = useFieldByKey(entityDefinitionId, fieldKey)

  const iconId =
    (field as { iconId?: string } | undefined)?.iconId ??
    (field?.fieldType ? fieldTypeOptions[field.fieldType as FieldType]?.iconId : undefined) ??
    'circle'

  const label = field?.label ?? formatFieldKey(fieldKey)

  return (
    <div className='flex min-h-[30px] w-full items-center gap-[4px] text-sm'>
      <div className='flex h-[24px] shrink-0 items-center gap-[4px]'>
        <EntityIcon iconId={iconId} variant='default' size='default' className='text-neutral-400' />
        <div className='flex w-[120px] items-center text-sm text-neutral-400 shrink-0'>
          <div className='truncate me-1'>{label}</div>
        </div>
      </div>
      <div className='relative flex min-w-0 flex-1 text-sm'>
        <div className='flex w-full flex-1 items-center gap-[4px] overflow-y-auto no-scrollbar'>
          {field ? (
            <FieldDisplay field={field} value={value} />
          ) : (
            <span className='truncate font-medium'>{String(value ?? '')}</span>
          )}
        </div>
      </div>
    </div>
  )
}
