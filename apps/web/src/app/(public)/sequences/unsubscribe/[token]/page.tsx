// apps/web/src/app/(public)/sequences/unsubscribe/[token]/page.tsx

import { getUnsubscribePayload } from '@auxx/lib/sequences'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UnsubscribeConfirmForm } from './unsubscribe-confirm-form'

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false },
}

interface UnsubscribePageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ state?: string }>
}

/**
 * Public, unauthenticated unsubscribe page (Sequences plan §8) —
 * `/sequences/unsubscribe/{token}`. Mirrors `/quote/{token}`: the token IS the
 * capability, no session, no org context; `getUnsubscribePayload` resolves it
 * and the page 404s on an unknown token rather than leaking whether one ever
 * existed. The confirm action is a plain form POST to the sibling `confirm`
 * route handler (the established public-mutation mechanism — see
 * `quote/[token]/accept/route.ts`), which 303-redirects back here.
 */
export default async function UnsubscribePage({ params, searchParams }: UnsubscribePageProps) {
  const [{ token }, sp] = await Promise.all([params, searchParams])

  const payload = await getUnsubscribePayload(token)
  if (!payload) notFound()

  const done = payload.alreadyUnsubscribed || sp.state === 'unsubscribed'
  const sender = payload.organizationName

  return (
    <main className='flex min-h-screen items-center justify-center bg-muted/40 p-4'>
      <div className='w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-xs'>
        {done ? (
          <>
            <h1 className='font-semibold text-lg'>You&apos;re unsubscribed.</h1>
            <p className='mt-2 text-muted-foreground text-sm'>
              You won&apos;t receive further emails from {sender ?? 'this sender'}.
            </p>
          </>
        ) : (
          <>
            <h1 className='font-semibold text-lg'>Unsubscribe</h1>
            <p className='mt-2 text-muted-foreground text-sm'>
              Stop receiving emails from {sender ?? 'this sender'}?
            </p>
            {sp.state === 'error' && (
              <p className='mt-2 text-destructive text-sm'>
                Something went wrong — please try again.
              </p>
            )}
            <UnsubscribeConfirmForm token={token} />
          </>
        )}
      </div>
    </main>
  )
}
