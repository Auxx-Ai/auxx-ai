// apps/web/src/components/kopilot/ui/blocks/entity-create-approval-card.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Check, Plus, X } from 'lucide-react'
import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'

/** Convert camelCase field keys to human-readable labels (e.g. "companyName" → "Company Name") */
function formatFieldKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

export function EntityCreateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const entityDefinitionId = args.entityDefinitionId as string

  // The LLM may nest field values under `values` or flatten them at the top level.
  // Handle both: prefer `args.values`, fall back to top-level keys minus known meta keys.
  const values =
    (args.values as Record<string, unknown>) ??
    Object.fromEntries(
      Object.entries(args).filter(([k]) => k !== 'entityDefinitionId' && k !== 'values')
    )

  const { resource } = useResource(entityDefinitionId)

  // Resolve field labels from resource fields, falling back to the raw key
  const fieldEntries = Object.entries(values)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => {
      const field = resource?.fields?.find((f) => (f.systemAttribute ?? f.key) === key)
      return { key, label: field?.label ?? formatFieldKey(key), value }
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
      {fieldEntries.length > 0 && (
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
      )}

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
