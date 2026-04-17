// apps/homepage/src/app/free-tools/_components/lead-capture-form.tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { submitFreeToolLead } from './actions'

type Props = {
  toolSlug: string
  buttonLabel?: string
  successMessage?: string
  /** Shown under the form as a disclaimer */
  disclaimer?: string
  /** URL to the downloadable asset, triggers a download link on success */
  downloadHref?: string
  downloadLabel?: string
}

export function LeadCaptureForm({
  toolSlug,
  buttonLabel = 'Send me the template',
  successMessage = 'Check your inbox — your copy is on the way.',
  disclaimer,
  downloadHref,
  downloadLabel = 'Download now',
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const email = String(formData.get('email') ?? '').trim()
    const name = String(formData.get('name') ?? '').trim()
    const website = String(formData.get('website') ?? '')

    if (!email) {
      setStatus('error')
      setErrorMessage('Please enter your email.')
      return
    }

    startTransition(async () => {
      const result = await submitFreeToolLead({
        toolSlug,
        email,
        name: name || undefined,
        website,
      })
      if (result.ok) {
        setStatus('success')
        setErrorMessage(null)
      } else {
        setStatus('error')
        setErrorMessage(result.error)
      }
    })
  }

  if (status === 'success') {
    return (
      <div className='space-y-4'>
        <p className='text-sm text-foreground'>{successMessage}</p>
        {downloadHref ? (
          <Button asChild variant='default' className='w-full'>
            <a href={downloadHref} download>
              {downloadLabel}
            </a>
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-3' noValidate>
      <div className='space-y-1.5'>
        <label htmlFor='lead-name' className='block text-xs font-medium text-foreground'>
          Name
        </label>
        <input
          id='lead-name'
          name='name'
          type='text'
          autoComplete='name'
          className='flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          placeholder='Your name'
        />
      </div>
      <div className='space-y-1.5'>
        <label htmlFor='lead-email' className='block text-xs font-medium text-foreground'>
          Email
        </label>
        <input
          id='lead-email'
          name='email'
          type='email'
          autoComplete='email'
          required
          className='flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          placeholder='you@example.com'
        />
      </div>
      {/* honeypot field — bots fill it, humans do not */}
      <div aria-hidden className='hidden'>
        <label htmlFor='lead-website'>Website</label>
        <input id='lead-website' name='website' type='text' tabIndex={-1} autoComplete='off' />
      </div>
      <Button type='submit' disabled={isPending} className='w-full'>
        {isPending ? 'Sending…' : buttonLabel}
      </Button>
      {status === 'error' && errorMessage ? (
        <p className='text-xs text-destructive'>{errorMessage}</p>
      ) : null}
      {disclaimer ? <p className='text-xs text-muted-foreground'>{disclaimer}</p> : null}
    </form>
  )
}
