// apps/web/src/components/webhooks/ui/webhook-endpoint-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Info, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { api, type RouterOutputs } from '~/trpc/react'
import { WebhookEndpointConfigureForm } from './webhook-endpoint-configure-form'
import {
  WebhookEndpointCreatedReveal,
  type WebhookEndpointReveal,
} from './webhook-endpoint-created'

type WebhookTemplateSummary = RouterOutputs['webhookEndpoint']['getTemplates'][number]
type WebhookTemplateDetail = NonNullable<RouterOutputs['webhookEndpoint']['getTemplateById']>

const FORM_ID = 'webhook-endpoint-create-form'

const VERIFICATION_LABEL: Record<string, string> = {
  none: 'Open (no verification)',
  token: 'Bearer token',
  hmac: 'HMAC signature',
  stripe: 'Stripe signature',
}

interface WebhookEndpointTemplateDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * "Add webhook endpoint" gallery. Picking a provider (Shopify/Stripe/GitHub) — or
 * "Start from scratch" — drills into the shared {@link WebhookEndpointConfigureForm},
 * prefilled from the template's verification config and curated topics. On create the
 * detail page swaps to the one-time URL/secret reveal. Wraps the shared
 * {@link TemplateGalleryDialog}; see plans/webhooks/webhook-endpoint-templates-plan.md.
 */
export function WebhookEndpointTemplateDialog({
  open,
  onClose,
}: WebhookEndpointTemplateDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reveal, setReveal] = useState<WebhookEndpointReveal | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: templates, isLoading } = api.webhookEndpoint.getTemplates.useQuery(undefined, {
    enabled: open,
  })
  const { data: detail } = api.webhookEndpoint.getTemplateById.useQuery(
    { id: selectedId ?? '' },
    { enabled: !!selectedId }
  )

  useEffect(() => {
    if (!open) {
      setSelectedId(null)
      setReveal(null)
      setSubmitting(false)
    }
  }, [open])

  return (
    <TemplateGalleryDialog<WebhookTemplateSummary>
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title='Add webhook endpoint'
      description='Pick a provider to prefill the configuration, or start from scratch.'
      crumbLabel='Endpoint templates'
      items={templates ?? []}
      isLoading={isLoading}
      categories={constants.webhookTemplateCategories}
      selectedId={selectedId}
      onSelectedIdChange={(id) => {
        setSelectedId(id)
        setReveal(null)
      }}
      onDetailExit={() => setReveal(null)}
      detailBusy={submitting}
      detailSize='lg'
      detailCrumb={(t) => t.name}
      renderIcon={(t) => (
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background'>
          {t.icon ? (
            <AppIcon iconId={t.icon} size='sm' />
          ) : (
            <Webhook className='size-4 text-muted-foreground' />
          )}
        </div>
      )}
      renderNameBadge={(t) =>
        t.blank || t.topicCount === 0 ? null : (
          <Badge variant='secondary' className='shrink-0 text-xs'>
            {t.topicCount} topics
          </Badge>
        )
      }
      renderDetail={() =>
        detail ? (
          reveal ? (
            <WebhookEndpointCreatedReveal reveal={reveal} onDone={onClose} />
          ) : (
            <TemplateDetailBody
              detail={detail}
              onCreated={setReveal}
              onPendingChange={setSubmitting}
              onCancel={onClose}
            />
          )
        ) : (
          <div className='p-6 text-sm text-muted-foreground'>Loading…</div>
        )
      }
      renderDetailFooter={() =>
        reveal ? null : (
          <Button
            type='submit'
            form={FORM_ID}
            size='sm'
            variant='outline'
            loading={submitting}
            loadingText='Creating...'>
            Create endpoint
          </Button>
        )
      }
    />
  )
}

/** The detail body: a config summary + curated-topics preview, then the prefilled form. */
function TemplateDetailBody({
  detail,
  onCreated,
  onPendingChange,
  onCancel,
}: {
  detail: WebhookTemplateDetail
  onCreated: (reveal: WebhookEndpointReveal) => void
  onPendingChange: (pending: boolean) => void
  onCancel: () => void
}) {
  return (
    <div className='flex flex-col'>
      {!detail.blank && (
        <div className='space-y-3 border-b p-4'>
          <p className='text-sm text-muted-foreground'>{detail.description}</p>
          {detail.note && (
            <div className='flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-800'>
              <Info className='size-4 shrink-0 text-sky-600' />
              <span>{detail.note}</span>
            </div>
          )}
          <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
            <dt className='text-muted-foreground'>Verification</dt>
            <dd>{VERIFICATION_LABEL[detail.config.verification] ?? detail.config.verification}</dd>
            {detail.config.topicSource && (
              <>
                <dt className='text-muted-foreground'>Topic source</dt>
                <dd>
                  {detail.config.topicSource.kind === 'header' ? 'Header' : 'JSON path'}{' '}
                  <span className='font-mono'>{detail.config.topicSource.value}</span>
                </dd>
              </>
            )}
          </dl>
          {detail.topics.length > 0 && (
            <div className='space-y-1'>
              <div className='text-xs font-medium text-muted-foreground'>
                Includes {detail.topics.length} topics
              </div>
              <div className='flex flex-wrap gap-1'>
                {detail.topics.map((t) => (
                  <Badge key={t.key} variant='outline' className='font-mono text-[11px]'>
                    {t.key}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <WebhookEndpointConfigureForm
        mode='create'
        template={detail}
        formId={FORM_ID}
        showFooter={false}
        onCreated={onCreated}
        onPendingChange={onPendingChange}
        onCancel={onCancel}
      />
    </div>
  )
}
