// apps/web/src/components/data-connectors/ui/connect-source-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Globe } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface ConnectSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "Connect a source" picker. v1 surfaces the built-in `generic-rest` connector
 * (a blank named connector the user then configures in the detail view). Picking
 * it creates the connector and routes into its detail view (the setup state).
 *
 * TODO(app-connector discovery): app connectors that declare `dataConnectors`
 * (e.g. Shopify) should also appear here, read from the installed-app catalog.
 * No tRPC query exposes a catalog's declared connectors yet — wire one and list
 * those rows alongside generic-rest. See plans/data-connectors/claude/05-frontend.md §1.
 */
export function ConnectSourceDialog({ open, onOpenChange }: ConnectSourceDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [name, setName] = useState('')

  const create = api.dataConnector.create.useMutation({
    onSuccess: (connector) => {
      void utils.dataConnector.list.invalidate()
      onOpenChange(false)
      setName('')
      router.push(`/app/connectors/${connector.id}`)
    },
    onError: (e) => toastError({ title: 'Could not create connector', description: e.message }),
  })

  const handleCreateGenericRest = () => {
    const trimmed = name.trim()
    create.mutate({ name: trimmed || 'New REST source', type: 'generic-rest' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Connect a source</DialogTitle>
          <DialogDescription>
            Sync external structured records into your entity system.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2 rounded-lg border p-4'>
            <div className='flex items-center gap-2'>
              <span className='flex size-8 items-center justify-center rounded-lg border'>
                <Globe className='size-4' />
              </span>
              <div className='flex flex-col'>
                <span className='text-sm font-medium'>Custom REST API</span>
                <span className='text-xs text-muted-foreground'>
                  Connect any HTTP/JSON endpoint — you define the request and mappings.
                </span>
              </div>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Source name (e.g. Acme CRM)'
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateGenericRest()
              }}
              autoFocus
            />
          </div>

          {/* App connectors (Shopify, etc.) land here once catalog discovery is wired. */}
          <div className='rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground'>
            App connectors (e.g. Shopify) appear here once installed. Coming soon.
          </div>
        </div>

        <DialogFooter>
          <Button size='sm' variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            size='sm'
            variant='outline'
            loading={create.isPending}
            loadingText='Creating...'
            onClick={handleCreateGenericRest}>
            Create source <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
