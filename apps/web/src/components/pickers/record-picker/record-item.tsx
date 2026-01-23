// apps/web/src/components/pickers/record-picker/record-item.tsx

'use client'

import { Check } from 'lucide-react'
import { CommandItem } from '@auxx/ui/components/command'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  isCustomResource,
  getDefinitionId,
  type RecordPickerItem,
  type RecordId,
} from '@auxx/lib/resources/client'
import { useResource } from '~/components/resources'

/**
 * Props for RecordItem display component
 */
export interface RecordItemProps {
  item: RecordPickerItem
  isSelected: boolean
  onToggle: (recordId: RecordId) => void
  showEntityType?: boolean
}

/**
 * Single item in the record picker list.
 * Displays avatar or entity icon with name and secondary info.
 */
export function RecordItem({ item, isSelected, onToggle, showEntityType }: RecordItemProps) {
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
      className="flex items-center gap-2">
      {item.avatarUrl ? (
        <Avatar className="size-5">
          <AvatarImage src={item.avatarUrl} />
          <AvatarFallback>{item.displayName?.[0]}</AvatarFallback>
        </Avatar>
      ) : (
        <EntityIcon
          iconId={resource?.icon ?? 'circle'}
          color={iconColor ?? 'gray'}
          size="sm"
          inverse
          className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
        />
      )}
      <div className="flex flex-1 items-center gap-1 flex-row">
        <span className="truncate">{item.displayName}</span>
        {item.secondaryInfo && (
          <span className="text-xs text-muted-foreground">{item.secondaryInfo}</span>
        )}
        {showEntityType && resource && (
          <span className="text-xs text-muted-foreground ml-auto">{resource.label}</span>
        )}
      </div>
      <Check className={cn('size-4', isSelected ? 'opacity-100' : 'opacity-0')} />
    </CommandItem>
  )
}
