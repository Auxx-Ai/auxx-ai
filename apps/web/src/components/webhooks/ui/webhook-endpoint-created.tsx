// apps/web/src/components/webhooks/ui/webhook-endpoint-created.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, Copy, KeyRound, Link } from 'lucide-react'
import type { ReactNode } from 'react'
import { Tooltip } from '~/components/global/tooltip'

/** The one-time reveal: the endpoint URL + (when minted) the plaintext secret. */
export interface WebhookEndpointReveal {
  url: string
  secret: string | null
  title: string
}

/** A read-only value in an `InputGroup` with a leading icon + copy button — URL / one-time secret. */
export function CopyRow({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
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
 * The terminal "created / secret rotated" panel: paste-this-URL copy, the one-time secret
 * (when Auxx minted one — Stripe endpoints show URL only), and a Done button.
 */
export function WebhookEndpointCreatedReveal({
  reveal,
  onDone,
}: {
  reveal: WebhookEndpointReveal
  onDone: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onDone()
      }}
      className='flex flex-col gap-4 p-4'>
      <p className='text-sm text-muted-foreground'>
        {reveal.secret
          ? 'Paste this URL into the external system. The secret is shown once — copy it now.'
          : 'Paste this URL into the external system.'}
      </p>
      <CopyRow label='Webhook URL' value={reveal.url} icon={<Link />} />
      {reveal.secret && (
        <CopyRow label='Signing secret' value={reveal.secret} icon={<KeyRound />} />
      )}
      <DialogFooter>
        <Button variant='outline' size='sm' type='submit'>
          Done <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}
