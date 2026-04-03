// apps/web/src/components/kopilot/ui/blocks/entity-create-approval-card.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Check, Plus, X } from 'lucide-react'
import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'

export function EntityCreateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const entityDefinitionId = args.entityDefinitionId as string
  const values = (args.values as Record<string, unknown>) ?? {}

  const { resource } = useResource(entityDefinitionId)

  // Resolve field labels from resource fields
  const fieldEntries = Object.entries(values).map(([key, value]) => {
    const field = resource?.fields?.find((f) => (f.systemAttribute ?? f.key) === key)
    return { key, label: field?.label ?? key, value }
  })

  return (
    <div className='rounded-lg border'>
      {/* Header */}
      <div className='flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground'>
        <Plus className='size-3' />
        <span className='font-medium'>Create {resource?.label ?? 'Record'}</span>
        {status !== 'pending' && (
          <Badge variant={status === 'approved' ? 'default' : 'destructive'} className='ml-auto'>
            {status === 'approved' ? 'Created' : 'Rejected'}
          </Badge>
        )}
      </div>

      {/* Proposed values */}
      <div className='px-3 py-2'>
        <div className='space-y-1.5'>
          {fieldEntries.map(({ key, label, value }) => (
            <div key={key} className='flex items-baseline gap-2 text-sm'>
              <span className='shrink-0 text-xs text-muted-foreground'>{label}:</span>
              <span className='truncate font-medium'>{String(value ?? '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      {status === 'pending' && (
        <div className='flex items-center justify-end gap-2 border-t px-3 py-2'>
          <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={onReject}>
            <X />
            Deny
          </Button>
          <Button size='sm' className='h-7 text-xs' onClick={() => onApprove()}>
            <Check />
            Create
          </Button>
        </div>
      )}
    </div>
  )
}
