// apps/web/src/components/data-connectors/ui/add-stream-dialog.tsx
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
import { useState } from 'react'
import type { api } from '~/trpc/react'

type Connector = NonNullable<ReturnType<typeof api.dataConnector.getById.useQuery>['data']>

interface AddStreamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connector: Connector
  onCreate: (streamKey: string) => void
  creating: boolean
}

/**
 * Add-stream dialog. Forks by connector kind (05 §4):
 * - generic-rest → a blank named stream the user then configures (request →
 *   schema → mappings) in the drill.
 * - catalog (app/built-in) → a picker over the connector's declared streams,
 *   pre-seeding schema + mappings.
 *
 * TODO(catalog streams): the connector's `ConnectorStreamDecl[]` isn't exposed
 * via tRPC yet. Until then app connectors fall back to the named-stream form
 * (the streamKey must match a declared stream). Wire a `listDeclaredStreams`
 * read + seed schema/mappings from the decl. See plans/data-connectors/claude/05-frontend.md §4.
 */
export function AddStreamDialog({
  open,
  onOpenChange,
  connector,
  onCreate,
  creating,
}: AddStreamDialogProps) {
  const isGenericRest = !connector.type.startsWith('app:')
  const [streamKey, setStreamKey] = useState('')

  const handleCreate = () => {
    const key = streamKey.trim()
    if (!key) return
    onCreate(key)
    setStreamKey('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Add a stream</DialogTitle>
          <DialogDescription>
            {isGenericRest
              ? 'A stream is one fetch — name it, then configure the request, schema, and mappings.'
              : 'Name the resource to fetch from this connector (e.g. order, customer).'}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-2'>
          <Input
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder={isGenericRest ? 'Stream name (e.g. orders)' : 'Resource key (e.g. order)'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
            }}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button size='sm' variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            size='sm'
            variant='outline'
            loading={creating}
            loadingText='Adding...'
            disabled={!streamKey.trim()}
            onClick={handleCreate}>
            Add stream <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
