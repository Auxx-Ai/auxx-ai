// apps/web/src/components/webhooks/ui/webhook-endpoint-dialog.tsx
'use client'

import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useState } from 'react'
import type { WebhookEndpointRow } from '../hooks/use-webhook-endpoint'
import { WebhookEndpointConfigureForm } from './webhook-endpoint-configure-form'
import {
  WebhookEndpointCreatedReveal,
  type WebhookEndpointReveal,
} from './webhook-endpoint-created'
import { WebhookEndpointTopicsPage } from './webhook-endpoint-topics-page'

interface WebhookEndpointDialogProps {
  open: boolean
  onClose: () => void
  /** The endpoint being edited. Create goes through `WebhookEndpointTemplateDialog`. */
  endpoint: WebhookEndpointRow
}

/**
 * Edit dialog for an inbound webhook endpoint, opened drilled into `configure`. Three pages
 * via `DialogNav`: `configure` (the shared {@link WebhookEndpointConfigureForm}), `created`
 * (the one-time reveal after a secret rotation/replacement), and `topics` (the per-topic schema
 * drill). New endpoints are created via the template gallery, which hosts the same form.
 */
export function WebhookEndpointDialog({ open, onClose, endpoint }: WebhookEndpointDialogProps) {
  const [page, setPage] = useState<'configure' | 'created' | 'topics'>('configure')
  const [revealed, setRevealed] = useState<WebhookEndpointReveal | null>(null)

  useEffect(() => {
    if (!open) return
    setPage('configure')
    setRevealed(null)
  }, [open, endpoint])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Edit webhook endpoint'
          description='Receive events from any system at a generated URL.'
          onBack={page === 'topics' ? () => setPage('configure') : undefined}
          crumbs={[
            {
              label: endpoint.name,
              onClick: page !== 'configure' ? () => setPage('configure') : undefined,
            },
            ...(page === 'created' ? [{ label: revealed?.title ?? 'Updated' }] : []),
            ...(page === 'topics' ? [{ label: 'Topics' }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='configure' size='md'>
            <WebhookEndpointConfigureForm
              mode='edit'
              endpoint={endpoint}
              onSaved={onClose}
              onRotated={(reveal) => {
                setRevealed(reveal)
                setPage('created')
              }}
              onOpenTopics={() => setPage('topics')}
              onCancel={onClose}
            />
          </DialogNavPage>

          <DialogNavPage value='created' size='md'>
            {revealed && <WebhookEndpointCreatedReveal reveal={revealed} onDone={onClose} />}
          </DialogNavPage>

          <DialogNavPage value='topics' size='md'>
            {page === 'topics' && (
              <WebhookEndpointTopicsPage endpoint={endpoint} onBack={() => setPage('configure')} />
            )}
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}
