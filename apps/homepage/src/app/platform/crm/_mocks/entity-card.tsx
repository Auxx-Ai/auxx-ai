// apps/homepage/src/app/platform/crm/_mocks/entity-card.tsx

import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import { ENTITY_COLOR_CLASS, type EntityColor } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'

export interface EntityCardAttr {
  icon: LucideIcon
  label: string
}

export interface EntityCardData {
  name: string
  badge: 'System' | 'Custom'
  color: EntityColor
  icon: LucideIcon
  attrs: EntityCardAttr[]
  more: number
}

/**
 * Attio-style attribute card for the CRM hero's relationship canvas:
 * entity header (colored icon badge + name + Standard/Custom pill),
 * three attribute rows, and a "+ N more attributes" footer.
 */
export function EntityCard({ data, className }: { data: EntityCardData; className?: string }) {
  const HeaderIcon = data.icon
  return (
    <div
      className={cn(
        'w-64 rounded-xl border border-border/70 bg-card text-card-foreground shadow-lg shadow-black/[.04]',
        className
      )}>
      <div className='flex items-center gap-2 px-3 py-2.5'>
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-md',
            ENTITY_COLOR_CLASS[data.color]
          )}>
          <HeaderIcon className='size-3.5' />
        </span>
        <span className='flex-1 truncate text-sm font-medium'>{data.name}</span>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
            data.badge === 'System'
              ? 'bg-fuchsia-400/15 text-fuchsia-700 dark:bg-fuchsia-400/10 dark:text-fuchsia-400'
              : 'border border-border/70 bg-muted/50 text-muted-foreground'
          )}>
          {data.badge}
        </span>
      </div>
      {data.attrs.map((attr) => {
        const Icon = attr.icon
        return (
          <div
            key={attr.label}
            className='flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs'>
            <Icon className='size-3.5 shrink-0 text-muted-foreground' />
            <span className='truncate text-foreground/80'>{attr.label}</span>
          </div>
        )
      })}
      <div className='flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground/80'>
        <Plus className='size-3.5 shrink-0' />
        <span>{data.more} more attributes</span>
      </div>
    </div>
  )
}
