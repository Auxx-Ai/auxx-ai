// apps/web/src/components/calls/ui/recording-action-items.tsx
'use client'

import type { ActionItem } from '@auxx/database'
import { Badge } from '@auxx/ui/components/badge'
import { Section } from '@auxx/ui/components/section'
import { ListChecks } from 'lucide-react'
import { api } from '~/trpc/react'

export function RecordingActionItems({ recordingId }: { recordingId: string }) {
  const { data: recording } = api.recording.getById.useQuery({ id: recordingId })
  const actionItems = (recording?.actionItems ?? []) as ActionItem[]

  return (
    <Section
      title={
        <span className='inline-flex items-center gap-1.5 leading-none'>
          Action items
          {actionItems.length > 0 && (
            <Badge variant='outline' className='h-4 px-1 text-[10px] font-normal leading-none'>
              {actionItems.length}
            </Badge>
          )}
        </span>
      }
      icon={<ListChecks className='size-3.5' />}
      collapsible={false}>
      {actionItems.length > 0 ? (
        <ul className='space-y-2'>
          {actionItems.map((item) => (
            <ActionItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground'>No action items extracted yet.</p>
      )}
    </Section>
  )
}

function ActionItemRow({ item }: { item: ActionItem }) {
  return (
    <li className='rounded-2xl border bg-background px-3 py-2'>
      <div className='flex items-start justify-start gap-2'>
        <span className='text-sm font-medium'>{item.title}</span>
        {item.priority && (
          <Badge
            variant={
              item.priority === 'high' ? 'red' : item.priority === 'medium' ? 'yellow' : 'gray'
            }
            size='xs'>
            {item.priority}
          </Badge>
        )}
      </div>
      {item.description && <p className='mt-1 text-xs text-muted-foreground'>{item.description}</p>}
      <div className='mt-2 flex flex-wrap items-center gap-1.5'>
        {item.owner && (
          <Badge variant='outline' size='xs'>
            Owner: {item.owner}
          </Badge>
        )}
        {item.dueDate && (
          <Badge variant='outline' size='xs'>
            Due: {item.dueDate}
          </Badge>
        )}
      </div>
    </li>
  )
}
