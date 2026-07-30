// apps/web/src/components/drawers/actions/create-quote-action.tsx
'use client'

// Request drawer header action (money MQ1 build spec §H.4, 01-ui.md #5). Looks
// up an existing active quote linked via `quote_request`; none → "Create quote"
// icon button (money.createQuoteFromRequest, navigates to the new quote's
// detail page). One exists → icon button that navigates to it instead — v1 is
// one active quote per request (§F.3's create-time guard mirrors this query).
//
// Icon-only + Tooltip matches the other registered header actions
// (ticket-reply-action.tsx, contact-compose-action.tsx, …) — the drawer header
// is a tight icon cluster, not a full-text button row.

import { getInstanceId, type RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { FileText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Tooltip } from '~/components/global/tooltip'
import { toRecordId } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import type { DrawerActionProps } from '../drawer-action-registry'

/** One-active-quote guard mirror (§F.3 createQuoteFromRequest) — quotes past these statuses don't block a new one. */
const INACTIVE_QUOTE_STATUSES = ['declined', 'canceled']

export function CreateQuoteAction({ recordId }: DrawerActionProps) {
  const router = useRouter()

  const { data, isLoading, refetch } = api.record.listFiltered.useQuery(
    {
      entityDefinitionId: 'quote',
      filters: [
        {
          id: 'request-quote-lookup',
          logicalOperator: 'AND',
          conditions: [
            {
              id: 'request-quote-lookup-request',
              fieldId: 'quote:request',
              operator: 'is',
              value: recordId,
            },
            {
              id: 'request-quote-lookup-status',
              fieldId: 'quote:status',
              operator: 'not in',
              value: INACTIVE_QUOTE_STATUSES,
            },
          ],
        },
      ],
      limit: 1,
    },
    { enabled: !!recordId }
  )

  const existingQuoteInstanceId = data?.ids[0]

  const createQuote = api.money.createQuoteFromRequest.useMutation({
    onSuccess: (result) => {
      router.push(`/app/quotes/${getInstanceId(result.recordId)}`)
    },
    onError: (error) => {
      toastError({ title: 'Error creating quote', description: error.message })
      void refetch()
    },
  })

  if (isLoading) return null

  if (existingQuoteInstanceId) {
    return <ExistingQuoteAction quoteRecordId={toRecordId('quote', existingQuoteInstanceId)} />
  }

  return (
    <Tooltip content='Create quote' allowInteraction>
      <Button
        variant='ghost'
        size='icon-xs'
        loading={createQuote.isPending}
        onClick={() => createQuote.mutate({ requestRecordId: recordId })}>
        <FileText />
      </Button>
    </Tooltip>
  )
}

/** Renders once an active quote already exists for this request — navigates to it. */
function ExistingQuoteAction({ quoteRecordId }: { quoteRecordId: RecordId }) {
  const router = useRouter()
  const { values, isLoading } = useSystemValues(quoteRecordId, ['quote_number', 'quote_status'], {
    autoFetch: true,
  })
  const statusField = useSystemField('quote_status')

  const number = values.quote_number as string | undefined
  const status = values.quote_status as string | undefined
  const statusLabel =
    statusField?.options?.options?.find((option) => option.value === status)?.label ?? status
  const instanceId = getInstanceId(quoteRecordId)

  const tooltipContent = isLoading
    ? 'Loading quote...'
    : `View quote ${number ?? ''}${statusLabel ? ` — ${statusLabel}` : ''}`

  return (
    <Tooltip content={tooltipContent} allowInteraction>
      <Button
        variant='ghost'
        size='icon-xs'
        onClick={() => router.push(`/app/quotes/${instanceId}`)}>
        <FileText />
      </Button>
    </Tooltip>
  )
}
