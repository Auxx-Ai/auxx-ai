// apps/web/src/app/(public)/sequences/unsubscribe/[token]/unsubscribe-confirm-form.tsx
'use client'

// Confirm button for the public unsubscribe page. Same shape as the public
// quote actions (`public-quote-actions.tsx`): a plain `method="post"` form to
// the token route handler — the mutation stays server-driven with a 303
// redirect — the client boundary only adds the submit pending state.

import { Button } from '@auxx/ui/components/button'
import { useState } from 'react'

/** POSTs to `/sequences/unsubscribe/{token}/confirm`. */
export function UnsubscribeConfirmForm({ token }: { token: string }) {
  const [isPending, setIsPending] = useState(false)

  return (
    <form
      method='post'
      action={`/sequences/unsubscribe/${token}/confirm`}
      onSubmit={() => setIsPending(true)}
      className='mt-4'>
      <Button type='submit' loading={isPending} loadingText='Unsubscribing...'>
        Unsubscribe
      </Button>
    </form>
  )
}
