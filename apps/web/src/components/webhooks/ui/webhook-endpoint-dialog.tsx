// apps/web/src/components/webhooks/ui/webhook-endpoint-dialog.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, Copy, KeyRound, Link, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import {
  seedValue,
  validateConnectionVariables,
} from '~/components/connections/ui/connection-variable-validation'
import { Tooltip } from '~/components/global/tooltip'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { useWebhookEndpoint, type WebhookEndpointRow } from '../hooks/use-webhook-endpoint'

interface WebhookEndpointDialogProps {
  open: boolean
  onClose: () => void
  /** Present ⇒ edit mode (opens on `configure`, no `created` page on save). */
  endpoint?: WebhookEndpointRow
}

/**
 * The endpoint config modeled as synthetic connection variables, rendered through the same
 * `ConnectionVariableFields` stack the connect dialogs use. `displayOptions.show` drives the
 * conditional rows for free (signature fields ⇐ hmac, topic value ⇐ topic source picked).
 */
const ENDPOINT_VARS: ConnectionVariable[] = [
  {
    key: 'name',
    label: 'Name',
    type: FieldType.TEXT,
    required: true,
    placeholder: 'Typeform leads',
  },
  {
    key: 'verification',
    label: 'Verification',
    type: FieldType.SINGLE_SELECT,
    required: true,
    default: 'hmac',
    description: 'How inbound deliveries are checked.',
    options: [
      { label: 'HMAC signature', value: 'hmac' },
      { label: 'Bearer token', value: 'token' },
      { label: 'None (open)', value: 'none' },
    ],
  },
  {
    key: 'signatureHeader',
    label: 'Signature header',
    type: FieldType.TEXT,
    required: true,
    default: 'x-hub-signature-256',
    placeholder: 'x-hub-signature-256',
    displayOptions: { show: { verification: ['hmac'] } },
  },
  {
    key: 'signaturePrefix',
    label: 'Signature prefix',
    type: FieldType.TEXT,
    required: false,
    placeholder: 'sha256=',
    description: 'Stripped before comparison (optional).',
    displayOptions: { show: { verification: ['hmac'] } },
  },
  {
    key: 'signatureEncoding',
    label: 'Signature encoding',
    type: FieldType.SINGLE_SELECT,
    required: true,
    default: 'hex',
    options: [
      { label: 'Hex (GitHub, Stripe)', value: 'hex' },
      { label: 'Base64 (Shopify-style)', value: 'base64' },
    ],
    displayOptions: { show: { verification: ['hmac'] } },
  },
  {
    key: 'topicSourceKind',
    label: 'Topic source',
    type: FieldType.SINGLE_SELECT,
    required: true,
    default: 'none',
    description: 'Optionally route deliveries on a topic pulled from each request.',
    options: [
      { label: 'No topic (every delivery matches)', value: 'none' },
      { label: 'From a header', value: 'header' },
      { label: 'From a JSON path', value: 'path' },
    ],
  },
  {
    key: 'topicSourceValue',
    label: 'Topic key',
    type: FieldType.TEXT,
    required: true,
    placeholder: 'x-github-event / type',
    displayOptions: { show: { topicSourceKind: ['header', 'path'] } },
  },
]

/** Seed the form: from the endpoint (edit) or each var's declared default (create). */
function seedValues(endpoint?: WebhookEndpointRow): Record<string, string> {
  if (endpoint) {
    return {
      name: endpoint.name,
      verification: endpoint.verification,
      signatureHeader: endpoint.signatureHeader ?? 'x-hub-signature-256',
      signaturePrefix: endpoint.signaturePrefix ?? '',
      signatureEncoding: endpoint.signatureEncoding,
      topicSourceKind: endpoint.topicSource?.kind ?? 'none',
      topicSourceValue: endpoint.topicSource?.value ?? '',
    }
  }
  return Object.fromEntries(ENDPOINT_VARS.map((v) => [v.key, seedValue(v)]))
}

/** A read-only value in an `InputGroup` with a leading icon + copy button — URL / one-time secret. */
function CopyRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  const { copy, copied } = useCopy({ toastMessage: `${label} copied` })
  return (
    <div className='space-y-1'>
      <Label>{label}</Label>
      <InputGroup>
        <InputGroupAddon align='inline-start'>{icon}</InputGroupAddon>
        <InputGroupInput
          type='text'
          value={value}
          readOnly
          className='font-mono text-xs'
          onFocus={(e) => e.target.select()}
        />
        <InputGroupAddon align='inline-end' className='gap-0.5'>
          <Tooltip content='Copy'>
            <InputGroupButton
              aria-label={`Copy ${label.toLowerCase()}`}
              className='rounded-full'
              size='icon-xs'
              onClick={() => copy(value)}>
              {copied ? <Check /> : <Copy />}
            </InputGroupButton>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

/**
 * Create / edit dialog for an inbound {@link WebhookEndpoint}. Two pages via `DialogNav`:
 * `configure` (the field form, rendered through `ConnectionVariableFields` like the connect
 * dialogs — see plans/data-connectors/v6/webhooks-ui-plan.md §6) and `created` (the one-time
 * URL + secret reveal, reached on create success or secret rotation). Edit opens on `configure`;
 * the stored secret is server-minted and never typed — only rotated.
 */
export function WebhookEndpointDialog({ open, onClose, endpoint }: WebhookEndpointDialogProps) {
  const isEdit = !!endpoint
  const { create, update, rotateSecret } = useWebhookEndpoint()

  const [page, setPage] = useState<'configure' | 'created'>('configure')
  const [values, setValues] = useState<Record<string, string>>(() => seedValues(endpoint))
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** The reveal shown on `created`: the endpoint URL + the one-time plaintext secret. */
  const [revealed, setRevealed] = useState<{
    url: string
    secret: string | null
    title: string
  } | null>(null)

  // Seed (edit) or reset (create) whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('configure')
    setRevealed(null)
    setErrors({})
    setValues(seedValues(endpoint))
  }, [open, endpoint])

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))
  const pending = create.isPending || update.isPending

  const handleSubmit = () => {
    const errs = validateConnectionVariables({ variables: ENDPOINT_VARS, values })
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const verification = values.verification as WebhookEndpointRow['verification']
    const isHmac = verification === 'hmac'
    const hasTopic = values.topicSourceKind === 'header' || values.topicSourceKind === 'path'
    const payload = {
      name: values.name.trim(),
      verification,
      signatureHeader: isHmac ? values.signatureHeader.trim() || undefined : undefined,
      signaturePrefix:
        isHmac && values.signaturePrefix.trim() ? values.signaturePrefix.trim() : undefined,
      signatureEncoding: isHmac ? (values.signatureEncoding as 'hex' | 'base64') : undefined,
      topicSource: hasTopic
        ? {
            kind: values.topicSourceKind as 'header' | 'path',
            value: values.topicSourceValue.trim(),
          }
        : null,
    }

    if (isEdit) {
      update.mutate({ id: endpoint.id, ...payload }, { onSuccess: onClose })
    } else {
      create.mutate(payload, {
        onSuccess: (res) => {
          setRevealed({ url: res.endpoint.url, secret: res.secret, title: 'Endpoint created' })
          setPage('created')
        },
      })
    }
  }

  const handleRotate = () => {
    if (!endpoint) return
    rotateSecret.mutate(
      { id: endpoint.id },
      {
        onSuccess: (res) => {
          setRevealed({ url: endpoint.url, secret: res.secret, title: 'Secret rotated' })
          setPage('created')
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={isEdit ? 'Edit webhook endpoint' : 'New webhook endpoint'}
          description='Receive events from any system at a generated URL.'
          crumbs={[
            { label: isEdit ? endpoint.name : 'New endpoint' },
            ...(page === 'created' ? [{ label: revealed?.title ?? 'Created' }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='configure' size='md'>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit()
              }}
              className='flex flex-col gap-4 p-4'>
              {isEdit && <CopyRow label='Webhook URL' value={endpoint.url} icon={<Link />} />}

              <div className='flex flex-col gap-2'>
                <div className='text-xs font-medium text-muted-foreground'>Configuration</div>
                <VarEditorField
                  orientation='responsive'
                  className='p-0 sm:[&_[data-slot=field-row-label]]:w-50!'>
                  <ConnectionVariableFields
                    variables={ENDPOINT_VARS}
                    values={values}
                    onValueChange={setValue}
                    errors={errors}
                    disabled={pending}
                  />
                </VarEditorField>
              </div>

              {values.verification === 'none' && (
                <div className='flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800'>
                  <TriangleAlert className='size-4 shrink-0 text-amber-600' />
                  <span>
                    Anyone with the URL can trigger this endpoint. Use a token or HMAC in
                    production.
                  </span>
                </div>
              )}

              {isEdit && endpoint.hasSecret && (
                <div className='flex items-center justify-between gap-2 rounded-lg border p-2.5'>
                  <div className='min-w-0'>
                    <div className='text-sm font-medium'>Signing secret</div>
                    <div className='font-mono text-xs text-muted-foreground'>••••••••••••</div>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    type='button'
                    onClick={handleRotate}
                    loading={rotateSecret.isPending}
                    loadingText='Rotating...'>
                    Rotate
                  </Button>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant='ghost'
                  size='sm'
                  type='button'
                  onClick={onClose}
                  disabled={pending}>
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
            </form>
          </DialogNavPage>

          <DialogNavPage value='created' size='md'>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onClose()
              }}
              className='flex flex-col gap-4 p-4'>
              <p className='text-sm text-muted-foreground'>
                Paste this URL into the external system. The secret is shown once — copy it now.
              </p>
              <CopyRow label='Webhook URL' value={revealed?.url ?? ''} icon={<Link />} />
              {revealed?.secret && (
                <CopyRow label='Signing secret' value={revealed.secret} icon={<KeyRound />} />
              )}
              <DialogFooter>
                <Button variant='outline' size='sm' type='submit'>
                  Done <KbdSubmit variant='outline' size='sm' />
                </Button>
              </DialogFooter>
            </form>
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}
