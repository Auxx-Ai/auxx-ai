// apps/web/src/components/money/ui/public-quote/public-quote-actions.tsx
'use client'

// Client action area for the public quote acceptance page (v5 build spec 01). The forms are
// still plain `method="post"` submits to the token route handlers — the mutation path stays
// server-driven with 303 redirects — the client boundary only adds submit pending states
// (`Button loading`) and the shadcn translucent inputs (Input/Textarea are client components).

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { useState } from 'react'

/** Accept form — typed-signature name + submit, POSTs to `/quote/{token}/accept`. */
export function QuoteAcceptForm({
  token,
  requireSignature,
}: {
  token: string
  requireSignature: boolean
}) {
  const [isPending, setIsPending] = useState(false)

  return (
    <form
      method='post'
      action={`/quote/${token}/accept`}
      onSubmit={() => setIsPending(true)}
      className='space-y-3'>
      <label
        htmlFor='quote-accept-name'
        className='block text-white/50 text-xs uppercase tracking-wide'>
        Type your full name to accept
      </label>
      <Input
        id='quote-accept-name'
        name='name'
        variant='translucent'
        size='lg'
        placeholder='Full name'
        required={requireSignature}
      />
      <Button
        type='submit'
        variant='translucent'
        size='lg'
        loading={isPending}
        loadingText='Accepting...'>
        Accept quote
      </Button>
    </form>
  )
}

/** Decline disclosure — hidden behind a low-key toggle so it never competes with Accept.
 * POSTs to `/quote/{token}/decline` with an optional reason. */
export function QuoteDeclineForm({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)

  if (!open) {
    return (
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='text-white/60 hover:bg-white/10 hover:text-white/90'
        onClick={() => setOpen(true)}>
        Need to decline instead?
      </Button>
    )
  }

  return (
    <div className='rounded-xl border border-white/10 bg-white/5 px-4 py-3'>
      <p className='text-sm text-white/70'>Decline this quote</p>
      <form
        method='post'
        action={`/quote/${token}/decline`}
        onSubmit={() => setIsPending(true)}
        className='mt-3 space-y-3'>
        <Textarea
          name='reason'
          placeholder='Optional — let us know why'
          rows={3}
          className='h-auto resize-none border-none bg-[#0519453d] text-white shadow-none placeholder:text-white/60 focus-visible:ring-white/30'
        />
        <div className='flex items-center gap-2'>
          <Button
            type='submit'
            variant='ghost'
            className='text-white/70 hover:bg-white/10 hover:text-white'
            loading={isPending}
            loadingText='Declining...'>
            Decline quote
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-white/50 hover:bg-white/10 hover:text-white/80'
            onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Expired-quote CTA — POSTs to `/quote/{token}/request-update`. */
export function QuoteRequestUpdateForm({ token }: { token: string }) {
  const [isPending, setIsPending] = useState(false)

  return (
    <form
      method='post'
      action={`/quote/${token}/request-update`}
      onSubmit={() => setIsPending(true)}>
      <Button type='submit' variant='translucent' loading={isPending} loadingText='Sending...'>
        Request an updated quote
      </Button>
    </form>
  )
}
