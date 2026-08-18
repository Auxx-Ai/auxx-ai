// apps/web/src/app/(public)/data-deletion/[code]/page.tsx
//
// The status page Meta hands the person after a data-deletion request
// (plan §4.5). Public and unauthenticated by contract — Meta's dashboard
// validator loads this URL in a fresh browser, and so does the person.
//
// ⚠️ `'data-deletion'` MUST stay in `KNOWN_ROUTE_PREFIXES` (apps/web/src/proxy.ts).
// Any top-level segment not in that set is treated as an org handle and
// redirected to /login — which would 302 the exact stranger we sent here.

import { database as db } from '@auxx/database'
import { getDeletionRequestByCode } from '@auxx/lib/data-deletion'
import {
  type DataDeletionKind,
  type DataDeletionStatus,
  isValidConfirmationCode,
} from '@auxx/lib/data-deletion/client'
import { createScopedLogger } from '@auxx/logger'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import type { Metadata } from 'next'
import { PublicDocumentShell } from '~/components/money/ui/public-document/public-document-shell'

export const metadata: Metadata = {
  title: 'Data deletion request',
  robots: { index: false, follow: false },
}

const logger = createScopedLogger('data-deletion-status')

const PRIVACY_EMAIL = 'privacy@auxx.ai'

interface DataDeletionStatusPageProps {
  params: Promise<{ code: string }>
}

/**
 * Resolve one request by its public confirmation code.
 *
 * An unknown code renders a neutral "no request found" body with **200, not
 * 404**, and never distinguishes a code that expired from one that never
 * existed — the page must not become an oracle for guessed codes.
 */
export default async function DataDeletionStatusPage({ params }: DataDeletionStatusPageProps) {
  const { code } = await params

  const request = await loadRequest(code)
  if (!request) {
    return (
      <PublicDocumentShell>
        <NotFoundCard code={code} />
      </PublicDocumentShell>
    )
  }

  const status = STATUS_COPY[request.status] ?? STATUS_COPY.received

  return (
    <PublicDocumentShell>
      <Card variant='translucent' className='w-full px-4 py-6 sm:px-10 sm:py-10'>
        <CardHeader className='gap-3 p-0'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <CardTitle className='text-xl'>Data deletion request</CardTitle>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className='text-sm text-white/70'>{status.description}</p>
        </CardHeader>

        <CardContent className='flex flex-col gap-6 p-0 pt-6 text-sm'>
          <dl className='flex flex-col gap-3'>
            <Row label='Confirmation code'>
              <span className='break-all font-mono'>{request.confirmationCode}</span>
            </Row>
            <Row label='Received'>{formatUtc(request.receivedAt)}</Row>
            <Row label='Completed'>
              {request.completedAt ? formatUtc(request.completedAt) : 'Not yet'}
            </Row>
          </dl>

          <section className='flex flex-col gap-2'>
            <h2 className='text-xs uppercase tracking-wide text-white/50'>What this covers</h2>
            {KIND_COPY[request.kind] ?? KIND_COPY.data_deletion}
          </section>

          <section className='flex flex-col gap-2'>
            <h2 className='text-xs uppercase tracking-wide text-white/50'>What is not deleted</h2>
            <p className='text-white/70'>
              The Messenger and Instagram conversations on the connected Page belong to the business
              that owns it, not to the person who connected it. Auxx.ai processes that
              customer-support history on the business&apos;s behalf, so it is deliberately left
              intact. If you are the business and want that history erased, write to us at{' '}
              <a className='underline underline-offset-2' href={`mailto:${PRIVACY_EMAIL}`}>
                {PRIVACY_EMAIL}
              </a>
              .
            </p>
          </section>

          <p className='text-xs text-white/50'>
            Keep this confirmation code — it is the only way to look this request up again.
          </p>
        </CardContent>
      </Card>
    </PublicDocumentShell>
  )
}

async function loadRequest(code: string) {
  // Cheap shape check first: a junk path segment should never become a query.
  if (!isValidConfirmationCode(code)) return null

  const result = await getDeletionRequestByCode(db, code)
  if (result.isErr()) {
    logger.error('Failed to load a deletion request for the status page', {
      error: result.error.message,
    })
    return null
  }
  return result.value
}

/**
 * Neutral miss. Renders with a normal 200 and says nothing about whether the
 * code expired, was never issued, or belongs to someone else.
 */
function NotFoundCard({ code }: { code: string }) {
  return (
    <Card variant='translucent' className='w-full px-4 py-6 sm:px-10 sm:py-10'>
      <CardHeader className='p-0'>
        <CardTitle className='text-xl'>No request found for this code</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4 p-0 pt-4 text-sm text-white/70'>
        <p>
          We have no data deletion request matching{' '}
          <span className='break-all font-mono text-white/90'>{code}</span>. Please check that the
          link was copied in full.
        </p>
        <p>
          If you believe this is wrong, write to{' '}
          <a className='underline underline-offset-2' href={`mailto:${PRIVACY_EMAIL}`}>
            {PRIVACY_EMAIL}
          </a>{' '}
          and include the code above.
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-wrap items-baseline justify-between gap-2 border-white/10 border-b pb-2 last:border-b-0 last:pb-0'>
      <dt className='text-white/50'>{label}</dt>
      <dd className='text-white/90'>{children}</dd>
    </div>
  )
}

/** Fixed UTC rendering — the server has no idea where the reader is. */
function formatUtc(value: Date): string {
  return `${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value)} UTC`
}

const STATUS_COPY: Record<
  DataDeletionStatus,
  { label: string; description: string; className: string }
> = {
  received: {
    label: 'Received',
    description: 'We have your request and it is queued for processing.',
    className: 'bg-sky-400/15 text-sky-200 ring-sky-400/30',
  },
  processing: {
    label: 'In progress',
    description: 'We are working through your request now.',
    className: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  },
  completed: {
    label: 'Completed',
    description: 'Your request has been carried out in full.',
    className: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30',
  },
  failed: {
    label: 'Needs attention',
    description:
      'This request did not finish automatically. It stays on record and is retried; if the status does not change, contact us at the address below.',
    className: 'bg-red-400/15 text-red-200 ring-red-400/30',
  },
}

const KIND_COPY: Record<DataDeletionKind, React.ReactNode> = {
  data_deletion: (
    <p className='text-white/70'>
      We delete the access credentials stored for the Facebook account that connected the Page — the
      encrypted login tokens and the account and Page details saved alongside them — revoke
      Auxx.ai&apos;s access with Facebook, and disconnect the affected Facebook and Instagram
      channels so no further messages are received.
    </p>
  ),
  deauthorize: (
    <p className='text-white/70'>
      Auxx.ai&apos;s access to the Facebook account that connected the Page has been removed, and
      the affected Facebook and Instagram channels have been paused so no further messages are
      received. This was a removal of the app rather than a deletion request, so the stored
      credentials are kept to allow reconnecting later. To have them deleted as well, submit a data
      deletion request from your Facebook settings.
    </p>
  ),
  customer_redact: (
    <p className='text-white/70'>
      We delete the personal details stored for this customer in the connected store data.
    </p>
  ),
  shop_redact: (
    <p className='text-white/70'>
      We delete the data synced from this store and the connection to it.
    </p>
  ),
  customer_data_request: (
    <p className='text-white/70'>
      We compile the data we hold for this customer and send it to the store that requested it.
    </p>
  ),
}
