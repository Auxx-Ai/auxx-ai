// apps/web/src/components/pickers/record-picker/record-item.tsx

'use client'

import {
  getDefinitionId,
  isCustomResource,
  type RecordId,
  type RecordPickerItem,
} from '@auxx/lib/resources/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { CommandItem } from '@auxx/ui/components/command'
import { Check } from 'lucide-react'
import { useResource } from '~/components/resources'
import { RecordIcon } from '~/components/resources/ui/record-icon'

/**
 * Props for RecordItem display component
 */
export interface RecordItemProps {
  item: RecordPickerItem
  isSelected: boolean
  onToggle: (recordId: RecordId) => void
  showEntityType?: boolean
  /** Show secondary info line next to the display name (default: true) */
  showSecondary?: boolean
  /** Multi-select mode shows checkbox, single-select shows circle check */
  multi?: boolean
}

/**
 * Single item in the record picker list.
 * Displays avatar or entity icon with name and secondary info.
 */
export function RecordItem({
  item,
  isSelected,
  onToggle,
  showEntityType,
  showSecondary = true,
  multi = true,
}: RecordItemProps) {
  const { resource } = useResource(getDefinitionId(item.recordId))
  const iconColor = resource && isCustomResource(resource) ? resource.color : undefined

  const handleSelect = () => {
    onToggle(item.recordId)
  }

  return (
    <CommandItem
      key={item.id}
      value={item.id}
      onSelect={handleSelect}
      className='flex items-center gap-2'>
      <RecordIcon
        avatarUrl={item.avatarUrl}
        iconId={resource?.icon ?? 'circle'}
        color={iconColor ?? 'gray'}
        size='sm'
        inverse
        className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
      />
      <div className='flex flex-1 min-w-0 items-center overflow-hidden'>
        <span className='truncate min-w-0'>{item.displayName}</span>
        {showSecondary && item.secondaryInfo && (
          <span className='truncate min-w-0 text-xs text-muted-foreground [flex-shrink:9999]'>
            {'\u00a0\u00a0'}
            {item.secondaryInfo}
          </span>
        )}
      </div>
      {showEntityType && resource && (
        <span className='shrink-0 text-xs text-muted-foreground'>{resource.label}</span>
      )}
      {multi ? (
        <Checkbox checked={isSelected} className='pointer-events-none' />
      ) : (
        isSelected && (
          <div className='rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        )
      )}
    </CommandItem>
  )
}
