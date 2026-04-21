// apps/web/src/components/kopilot/ui/blocks/entity-definition-block.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Database } from 'lucide-react'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { EntityDefinitionData } from './block-schemas'

export function EntityDefinitionBlock({ data }: BlockRendererProps<EntityDefinitionData>) {
  const { fields, label } = data

  return (
    <div className='not-prose my-2'>
      <BlockCard
        data-slot='entity-definition-block'
        indicator={<Database className='size-3 text-muted-foreground' />}
        primaryText={label ?? 'Fields'}
        secondaryText={<span className='text-xs text-muted-foreground'>{fields.length}</span>}
        hasFooter={false}>
        <div className='divide-y'>
          {fields.map((field) => (
            <div key={field.id} className='flex items-start gap-2 px-1.5 py-1.5'>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2 text-sm'>
                  <span className='truncate font-medium'>{field.label}</span>
                  {field.systemAttribute && (
                    <span className='truncate text-[10px] text-muted-foreground'>
                      {field.systemAttribute}
                    </span>
                  )}
                </div>
                {field.relationship?.targetEntityDefinitionId && (
                  <p className='text-[10px] text-muted-foreground'>
                    → {field.relationship.targetEntityDefinitionId}
                  </p>
                )}
              </div>
              {field.fieldType && (
                <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
                  {field.fieldType}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </BlockCard>
    </div>
  )
}
