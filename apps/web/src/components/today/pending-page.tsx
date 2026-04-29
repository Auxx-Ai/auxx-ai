// apps/web/src/components/today/pending-page.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

/**
 * Pending AI-originated sends. Each row shows the recipient and a countdown
 * until send. Cancel within the buffer (5 min) before the row flips to
 * PROCESSING; once it does, cancel returns a 409 ('send_in_flight').
 *
 * Countdown ticks client-side from `scheduledAt`. Browser tab throttling
 * when backgrounded would normally drift the timer, but `useEffect` re-syncs
 * on focus implicitly via the parent re-render — refetch is the safety net.
 */
export function PendingSendsPage() {
  const utils = api.useUtils()
  const list = api.approvals.listPending.useQuery({ mineOnly: true })
  const cancel = api.approvals.cancelPendingSend.useMutation({
    onSuccess: () => {
      utils.approvals.listPending.invalidate()
    },
    onError: (error) => {
      const message =
        error.data?.code === 'CONFLICT' && error.message === 'send_in_flight'
          ? "Send in flight, can't cancel"
          : error.message
      toastError({ title: 'Cancel failed', description: message })
      utils.approvals.listPending.invalidate()
    },
  })

  return (
    <div className='max-w-3xl mx-auto py-8 px-4 flex flex-col gap-4'>
      <header className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-semibold'>Pending sends</h1>
          <p className='text-sm text-muted-foreground'>
            AI-approved messages held for the cancel window before send.
          </p>
        </div>
        <Link href='/app/today'>
          <Button variant='outline' size='sm'>
            Back to Today
          </Button>
        </Link>
      </header>

      {list.isLoading && <div className='text-sm text-muted-foreground'>Loading…</div>}
      {list.data && list.data.items.length === 0 && (
        <div className='text-sm text-muted-foreground'>No pending sends.</div>
      )}
      <div className='flex flex-col gap-3'>
        {list.data?.items.map((row) => (
          <PendingRow
            key={row.id}
            id={row.id}
            scheduledAt={new Date(row.scheduledAt)}
            sendPayload={row.sendPayload as PayloadShape}
            onCancel={() => cancel.mutate({ scheduledMessageId: row.id })}
            cancelling={cancel.isPending && cancel.variables?.scheduledMessageId === row.id}
          />
        ))}
      </div>
    </div>
  )
}

interface PayloadShape {
  to?: Array<{ identifier: string; name?: string }>
  subject?: string
  textPlain?: string
  textHtml?: string
}

function PendingRow({
  scheduledAt,
  sendPayload,
  onCancel,
  cancelling,
}: {
  id: string
  scheduledAt: Date
  sendPayload: PayloadShape
  onCancel: () => void
  cancelling: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const remainingMs = scheduledAt.getTime() - now
  const expired = remainingMs <= 0
  const recipient = sendPayload.to?.[0]?.identifier ?? '(unknown)'
  const preview =
    sendPayload.textPlain ?? sendPayload.textHtml?.replace(/<[^>]+>/g, ' ').trim() ?? '(no body)'

  return (
    <Card className='p-4 flex items-start justify-between gap-4'>
      <div className='flex-1 min-w-0'>
        <div className='text-sm font-medium'>To: {recipient}</div>
        {sendPayload.subject && <div className='text-sm mt-1'>{sendPayload.subject}</div>}
        <div className='text-sm text-muted-foreground mt-1 line-clamp-2'>{preview}</div>
        <div className='text-xs text-muted-foreground mt-2'>
          {expired ? 'Sending…' : `Sends in ${formatRemaining(remainingMs)}`}
        </div>
      </div>
      <Button
        variant='outline'
        size='sm'
        disabled={cancelling || expired}
        loading={cancelling}
        onClick={onCancel}>
        Cancel
      </Button>
    </Card>
  )
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
