// apps/web/src/components/pickers/resource-picker/resource-item.tsx

'use client'

import type { Resource } from '@auxx/lib/resources/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { CommandItem } from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Check } from 'lucide-react'

/**
 * Props for ResourceItem display component
 */
export interface ResourceItemProps {
  resource: Resource
  isSelected: boolean
  onToggle: (resourceId: string) => void
  /** Multi-select mode shows checkbox, single-select shows styled check */
  multi?: boolean
}

/**
 * Single item in the resource picker list.
 * Shows entity icon, resource label, and selection indicator.
 */
export function ResourceItem({ resource, isSelected, onToggle, multi = false }: ResourceItemProps) {
  /** Handle selection of this resource */
  const handleSelect = () => {
    onToggle(resource.id)
  }

  return (
    <CommandItem
      key={resource.id}
      value={resource.id}
      keywords={[resource.label]}
      onSelect={handleSelect}
      className='flex items-center gap-2'>
      <EntityIcon
        iconId={resource.icon ?? 'circle'}
        color={resource.color ?? 'gray'}
        size='sm'
        inverse
        className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
      />
      <div className='flex items-center gap-1 flex-1 min-w-0'>
        <span className='truncate'>{resource.label}</span>
      </div>
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
