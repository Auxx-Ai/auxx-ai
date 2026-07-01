// apps/web/src/components/webhooks/ui/webhook-endpoint-configure-form.tsx
'use client'

import type { WebhookEndpointTemplate } from '@auxx/lib/webhooks/endpoint-templates'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { generateId } from '@auxx/utils'
import { ChevronRight, KeyRound, Link, Tags, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import { validateConnectionVariables } from '~/components/connections/ui/connection-variable-validation'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useWebhookEndpoint, type WebhookEndpointRow } from '../hooks/use-webhook-endpoint'
import type { WebhookEndpointReveal } from './webhook-endpoint-created'
import { CopyRow } from './webhook-endpoint-created'
import {
  blankSeedValues,
  endpointVars,
  seedValuesFromEndpoint,
  seedValuesFromTemplate,
} from './webhook-endpoint-fields'

interface WebhookEndpointConfigureFormProps {
  /** `create` seeds from `template` (or blank); `edit` seeds from `endpoint`. */
  mode: 'create' | 'edit'
  /** edit mode — the endpoint being edited. */
  endpoint?: WebhookEndpointRow
  /** create-from-template mode — the chosen template (blank ⇒ empty form). */
  template?: WebhookEndpointTemplate
  /** Create success ⇒ the one-time reveal (URL + minted secret). */
  onCreated?: (reveal: WebhookEndpointReveal) => void
  /** Edit save success. */
  onSaved?: () => void
  /** Secret rotation/replacement success ⇒ the one-time reveal. */
  onRotated?: (reveal: WebhookEndpointReveal) => void
  /** Open the topics drill-down (edit mode only). */
  onOpenTopics?: () => void
  onCancel: () => void
  /** When hosted in the gallery detail, the `<form>` id an external submit button targets. */
  formId?: string
  /** Hide the built-in Cancel/Save footer (the host renders its own). Default `true`. */
  showFooter?: boolean
  /** Bubble the create/update pending state up to an external submit button. */
  onPendingChange?: (pending: boolean) => void
}

/**
 * The endpoint configure form, shared by the create-from-template gallery host and the
 * standalone edit dialog. Renders the synthetic connection-variable fields, the open-endpoint
 * warning, and (edit) the signing-secret rotate/replace + topics drill. Owns `values`/`errors`
 * and the create/update/rotate mutations; the host owns the surrounding chrome and the reveal.
 */
export function WebhookEndpointConfigureForm({
  mode,
  endpoint,
  template,
  onCreated,
  onSaved,
  onRotated,
  onOpenTopics,
  onCancel,
  formId,
  showFooter = true,
  onPendingChange,
}: WebhookEndpointConfigureFormProps) {
  const isEdit = mode === 'edit'
  const { create, update, rotateSecret } = useWebhookEndpoint()

  const seed = () => {
    if (isEdit && endpoint) return seedValuesFromEndpoint(endpoint)
    if (template) return seedValuesFromTemplate(template)
    return blankSeedValues()
  }

  const [values, setValues] = useState<Record<string, string>>(seed)
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** Stripe edit: the inline "paste a new whsec_" input is open. */
  const [replacingSecret, setReplacingSecret] = useState(false)
  const [newSecret, setNewSecret] = useState('')

  // Reseed when the target changes (e.g. switching templates in the gallery).
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed derives from endpoint/template.
  useEffect(() => {
    setValues(seed())
    setErrors({})
    setReplacingSecret(false)
    setNewSecret('')
  }, [endpoint, template])

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))
  const pending = create.isPending || update.isPending

  // biome-ignore lint/correctness/useExhaustiveDependencies: report pending to the host's submit button.
  useEffect(() => onPendingChange?.(pending), [pending])

  const handleSubmit = () => {
    const variables = endpointVars(values.topicSourceKind, {
      includeStripeSecret: mode === 'create',
    })
    const errs = validateConnectionVariables({ variables, values })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const verification = values.verification as WebhookEndpointRow['verification']
    const isHmac = verification === 'hmac'
    const isStripe = verification === 'stripe'
    const hasTopic = values.topicSourceKind === 'header' || values.topicSourceKind === 'path'

    const topicSource = hasTopic
      ? { kind: values.topicSourceKind as 'header' | 'path', value: values.topicSourceValue.trim() }
      : null

    if (isEdit && endpoint) {
      update.mutate(
        {
          id: endpoint.id,
          name: values.name.trim(),
          verification,
          signatureHeader: isHmac ? values.signatureHeader.trim() || undefined : undefined,
          signaturePrefix:
            isHmac && values.signaturePrefix.trim() ? values.signaturePrefix.trim() : undefined,
          signatureEncoding: isHmac ? (values.signatureEncoding as 'hex' | 'base64') : undefined,
          topicSource,
        },
        { onSuccess: onSaved }
      )
      return
    }

    // Create — carry the template's curated topics (only when a topic source is set).
    const topics =
      hasTopic && template && !template.blank
        ? template.topics.map((t) => ({ ...t, id: generateId() }))
        : undefined

    create.mutate(
      {
        name: values.name.trim(),
        provider: template && !template.blank ? template.provider : undefined,
        verification,
        signatureHeader: isHmac ? values.signatureHeader.trim() || undefined : undefined,
        signaturePrefix:
          isHmac && values.signaturePrefix.trim() ? values.signaturePrefix.trim() : undefined,
        signatureEncoding: isHmac ? (values.signatureEncoding as 'hex' | 'base64') : undefined,
        secret: isStripe ? values.stripeSecret.trim() : undefined,
        topicSource,
        topics,
      },
      {
        onSuccess: (res) =>
          onCreated?.({ url: res.endpoint.url, secret: res.secret, title: 'Endpoint created' }),
      }
    )
  }

  const handleRotate = () => {
    if (!endpoint) return
    const isStripe = endpoint.verification === 'stripe'
    rotateSecret.mutate(
      { id: endpoint.id, secret: isStripe ? newSecret.trim() : undefined },
      {
        onSuccess: (res) => {
          setReplacingSecret(false)
          setNewSecret('')
          onRotated?.({
            url: endpoint.url,
            secret: res.secret,
            title: isStripe ? 'Secret replaced' : 'Secret rotated',
          })
        },
      }
    )
  }

  const isStripeEdit = isEdit && endpoint?.verification === 'stripe'

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className='flex flex-col gap-4 p-4'>
      {isEdit && endpoint && <CopyRow label='Webhook URL' value={endpoint.url} icon={<Link />} />}

      <div className='flex flex-col gap-2'>
        <div className='text-xs font-medium text-muted-foreground'>Configuration</div>
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='webhook-endpoint'
          defaultLabelWidth={200}
          className='p-0'>
          <ConnectionVariableFields
            variables={endpointVars(values.topicSourceKind, {
              includeStripeSecret: mode === 'create',
            })}
            values={values}
            onValueChange={setValue}
            errors={errors}
            disabled={pending}
          />
        </FieldPanel>
      </div>

      {values.verification === 'none' && (
        <div className='flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800'>
          <TriangleAlert className='size-4 shrink-0 text-amber-600' />
          <span>
            Anyone with the URL can trigger this endpoint. Use a token or HMAC in production.
          </span>
        </div>
      )}

      {isEdit && endpoint?.hasSecret && (
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='webhook-endpoint'
          defaultLabelWidth={200}
          className='p-0'>
          <FieldPanelRow title='Signing secret' icon={<KeyRound />} showIcon>
            {isStripeEdit && replacingSecret ? (
              <div className='flex min-h-8 items-center gap-2 pe-1'>
                <Input
                  type='password'
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder='whsec_…'
                  className='h-8 font-mono text-xs'
                  autoFocus
                />
                <Button
                  variant='outline'
                  size='xs'
                  type='button'
                  onClick={handleRotate}
                  disabled={!newSecret.trim()}
                  loading={rotateSecret.isPending}
                  loadingText='Saving...'>
                  Save
                </Button>
                <Button
                  variant='ghost'
                  size='xs'
                  type='button'
                  onClick={() => {
                    setReplacingSecret(false)
                    setNewSecret('')
                  }}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className='flex min-h-8 items-center justify-between gap-2 pe-1'>
                <span className='font-mono text-xs text-muted-foreground'>••••••••••••</span>
                <Button
                  variant='ghost'
                  size='xs'
                  type='button'
                  onClick={() => (isStripeEdit ? setReplacingSecret(true) : handleRotate())}
                  loading={rotateSecret.isPending && !isStripeEdit}
                  loadingText='Rotating...'>
                  {isStripeEdit ? 'Replace' : 'Rotate'}
                </Button>
              </div>
            )}
          </FieldPanelRow>
        </FieldPanel>
      )}

      {isEdit &&
        (endpoint?.topicSource ? (
          <div className='flex flex-col gap-2'>
            <Button
              variant='outline'
              size='sm'
              type='button'
              className='w-full justify-between'
              onClick={onOpenTopics}>
              <span className='flex items-center gap-2'>
                <Tags />
                {endpoint.topics.length > 0 ? `Topics (${endpoint.topics.length})` : 'Setup topics'}
              </span>
              <ChevronRight />
            </Button>
            {endpoint.topics.length > 0 && (
              <div className='flex flex-wrap gap-1'>
                {endpoint.topics.map((topic) => (
                  <Badge key={topic.id} variant='outline' className='font-mono text-[11px]'>
                    {topic.key}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className='text-xs text-muted-foreground'>
            Set a topic source above to define topics and capture their schemas.
          </p>
        ))}

      {showFooter && (
        <DialogFooter>
          <Button variant='ghost' size='sm' type='button' onClick={onCancel} disabled={pending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            type='submit'
            loading={pending}
            loadingText='Saving...'>
            {isEdit ? 'Save' : 'Create'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      )}
    </form>
  )
}
