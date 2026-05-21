// apps/web/src/components/chat-widget/ui/settings/sections/domains-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { Globe, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface DomainsSectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

export function DomainsSection({ widget, channelId }: DomainsSectionProps) {
  const utils = api.useUtils()
  const [domains, setDomains] = useState<string[]>(widget.chatWidget?.allowedDomains ?? [])
  const [draft, setDraft] = useState('')

  const update = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const handleAdd = () => {
    const value = draft.trim().toLowerCase()
    if (!value) return
    if (domains.includes(value)) {
      toastError({ title: 'Domain already added' })
      return
    }
    setDomains([...domains, value])
    setDraft('')
  }

  const handleRemove = (d: string) => setDomains(domains.filter((x) => x !== d))

  const handleSave = () => {
    update.mutate({ integrationId: channelId, allowedDomains: domains })
  }

  const dirty = JSON.stringify(domains) !== JSON.stringify(widget.chatWidget?.allowedDomains ?? [])

  return (
    <div>
      <div className='p-6'>
        <div className='space-y-1 mb-6'>
          <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
            <Globe className='size-4' /> Allowed Domains
          </div>
          <p className='text-sm text-muted-foreground'>
            Restrict where the widget can be embedded. Empty list = allow anywhere.
          </p>
        </div>

        <div className='flex items-center gap-2'>
          <Input
            placeholder='example.com'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
          <Button type='button' variant='outline' onClick={handleAdd}>
            <Plus />
            Add
          </Button>
        </div>

        <div className='mt-3 max-h-64 space-y-1 overflow-y-auto rounded border p-2'>
          {domains.length === 0 ? (
            <p className='py-2 text-center text-sm text-muted-foreground'>
              No domain restrictions — the widget will load on any site.
            </p>
          ) : (
            domains.map((d) => (
              <div
                key={d}
                className='flex items-center justify-between rounded bg-background p-1 px-2 text-sm'>
                <span>{d}</span>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => handleRemove(d)}
                  className='h-6 px-1 text-muted-foreground hover:text-destructive'>
                  <X className='size-3.5' />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className='flex justify-end gap-2 border-t px-4 py-4'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => setDomains(widget.chatWidget?.allowedDomains ?? [])}
          disabled={!dirty}>
          Reset
        </Button>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={handleSave}
          disabled={!dirty}
          loading={update.isPending}
          loadingText='Saving…'>
          Save Changes
        </Button>
      </div>
    </div>
  )
}
