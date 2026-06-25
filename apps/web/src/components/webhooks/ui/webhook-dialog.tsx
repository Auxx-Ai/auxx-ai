// apps/web/src/components/webhooks/ui/webhook-dialog.tsx
'use client'
import type { WebhookEntity as Webhook } from '@auxx/database/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { WebhookForm } from './webhook-form'

interface DialogWebhookProps {
  open: boolean
  onClose: () => void
  webhook?: Webhook
  onSuccess?: () => void
}

/**
 * Thin modal wrapper around {@link WebhookForm}. Supplies the `Dialog` shell and
 * the header; all form logic lives in the core, which the command palette hosts
 * directly as a page. Public API is unchanged.
 */
export function DialogWebhook({ open, onClose, webhook, onSuccess }: DialogWebhookProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='sm' position='tc'>
        <WebhookForm
          open={open}
          webhook={webhook}
          onSuccess={onSuccess}
          onClose={onClose}
          header={({ title }) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
