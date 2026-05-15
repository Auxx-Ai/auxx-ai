// apps/web/src/components/agents/ui/detail/triggers/trigger-create-form.tsx
'use client'

import { ALLOWED_DIRECT_EVENT_TYPES } from '@auxx/lib/agents/client'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface TriggerCreateFormProps {
  agentId: string
  onDone: () => void
}

type Kind = 'scheduled' | 'event'
type Interval = 'minutes' | 'hours' | 'days' | 'weeks'
type EventMode = 'crud' | 'direct'
type CrudTriggerType = 'created' | 'updated' | 'deleted'

/**
 * Inline form for creating an agent trigger. v1 ships `scheduled` and the
 * `event` kind (CRUD + direct-match). `app` kind ships with PR-4.
 */
export function TriggerCreateForm({ agentId, onDone }: TriggerCreateFormProps) {
  const [kind, setKind] = useState<Kind>('scheduled')
  const [interval, setInterval] = useState<Interval>('hours')
  const [value, setValue] = useState<number>(1)
  const [customCron, setCustomCron] = useState('')
  const [useCustomCron, setUseCustomCron] = useState(false)
  const [eventMode, setEventMode] = useState<EventMode>('crud')
  const [triggerType, setTriggerType] = useState<CrudTriggerType>('created')
  const [entityDefinitionId, setEntityDefinitionId] = useState('ticket')
  const [directEventType, setDirectEventType] =
    useState<(typeof ALLOWED_DIRECT_EVENT_TYPES)[number]>('ticket:assignee:added')

  const create = api.agentTrigger.create.useMutation({
    onSuccess: () => onDone(),
    onError: (err) => toastError({ title: 'Failed to create trigger', description: err.message }),
  })

  const submit = () => {
    if (kind === 'scheduled') {
      if (useCustomCron) {
        if (!customCron.trim()) {
          toastError({ title: 'Custom cron is required' })
          return
        }
        create.mutate({
          agentId,
          trigger: {
            kind: 'scheduled',
            config: {
              triggerInterval: 'custom',
              timeBetweenTriggers: {},
              customCron,
            },
          },
        })
        return
      }
      create.mutate({
        agentId,
        trigger: {
          kind: 'scheduled',
          config: {
            triggerInterval: interval,
            timeBetweenTriggers: { [interval]: value, isConstant: true },
          },
        },
      })
      return
    }

    if (eventMode === 'crud') {
      create.mutate({
        agentId,
        trigger: {
          kind: 'event',
          triggerType,
          entityDefinitionId,
        },
      })
      return
    }

    create.mutate({
      agentId,
      trigger: {
        kind: 'event',
        eventType: directEventType,
      },
    })
  }

  return (
    <div className='rounded-md border bg-muted/30 p-4 space-y-4'>
      <div className='space-y-2'>
        <Label>Kind</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <SelectTrigger className='w-48'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='scheduled'>Scheduled</SelectItem>
            <SelectItem value='event'>Event</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {kind === 'scheduled' ? (
        <div className='space-y-3'>
          <div className='flex items-center gap-2'>
            <input
              type='checkbox'
              id='customCron'
              checked={useCustomCron}
              onChange={(e) => setUseCustomCron(e.target.checked)}
            />
            <Label htmlFor='customCron' className='cursor-pointer'>
              Use custom cron pattern
            </Label>
          </div>
          {useCustomCron ? (
            <div className='space-y-2'>
              <Label>Cron expression</Label>
              <Input
                placeholder='0 */5 * * * *'
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                className='w-72'
              />
              <p className='text-xs text-muted-foreground'>
                BullMQ 6-field cron — sec min hour day month dow.
              </p>
            </div>
          ) : (
            <div className='flex items-end gap-2'>
              <div className='space-y-2'>
                <Label>Every</Label>
                <Input
                  type='number'
                  min={1}
                  value={value}
                  onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))}
                  className='w-24'
                />
              </div>
              <div className='space-y-2'>
                <Label>Unit</Label>
                <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
                  <SelectTrigger className='w-36'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='minutes'>Minutes</SelectItem>
                    <SelectItem value='hours'>Hours</SelectItem>
                    <SelectItem value='days'>Days</SelectItem>
                    <SelectItem value='weeks'>Weeks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {kind === 'event' ? (
        <div className='space-y-3'>
          <div className='space-y-2'>
            <Label>Event mode</Label>
            <Select value={eventMode} onValueChange={(v) => setEventMode(v as EventMode)}>
              <SelectTrigger className='w-56'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='crud'>Resource CRUD (created/updated/deleted)</SelectItem>
                <SelectItem value='direct'>Direct event (named)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {eventMode === 'crud' ? (
            <div className='flex items-end gap-2'>
              <div className='space-y-2'>
                <Label>Action</Label>
                <Select
                  value={triggerType}
                  onValueChange={(v) => setTriggerType(v as CrudTriggerType)}>
                  <SelectTrigger className='w-36'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='created'>Created</SelectItem>
                    <SelectItem value='updated'>Updated</SelectItem>
                    <SelectItem value='deleted'>Deleted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label>Entity</Label>
                <Input
                  value={entityDefinitionId}
                  onChange={(e) => setEntityDefinitionId(e.target.value)}
                  placeholder='ticket'
                  className='w-48'
                />
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              <Label>Event type</Label>
              <Select
                value={directEventType}
                onValueChange={(v) =>
                  setDirectEventType(v as (typeof ALLOWED_DIRECT_EVENT_TYPES)[number])
                }>
                <SelectTrigger className='w-72'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_DIRECT_EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      ) : null}

      <div className='flex justify-end gap-2'>
        <Button variant='ghost' onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} loading={create.isPending}>
          Create trigger
        </Button>
      </div>
    </div>
  )
}
