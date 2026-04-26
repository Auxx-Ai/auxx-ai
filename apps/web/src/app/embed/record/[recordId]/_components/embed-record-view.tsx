// apps/web/src/app/embed/record/[recordId]/_components/embed-record-view.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import Loader from '@auxx/ui/components/loader'
import { CompactFieldList } from '~/components/fields/compact-field-list'
import { useRecord } from '~/components/resources'
import { EmbedRecordHeader } from './embed-record-header'

interface EmbedRecordViewProps {
  recordId: string
}

/**
 * Body of the embed page: identity header + compact field list.
 * The recordId comes in as a raw URL segment and is treated as a branded
 * `RecordId` because the embed-token handshake already gated the request
 * — at this point the user is authenticated and the tRPC layer enforces
 * org scoping on every read.
 *
 * Defers rendering the header + field list until `useRecord` resolves so
 * the iframe shows one continuous loading state instead of a half-
 * rendered header (avatar placeholder, displayName "…") while the
 * client-side fetch is in flight.
 */
export function EmbedRecordView({ recordId }: EmbedRecordViewProps) {
  const branded = recordId as RecordId
  const { record, isLoading } = useRecord({ recordId: branded })

  if (isLoading && !record) {
    return <Loader size='sm' title='Loading' subtitle='' className='h-full' />
  }

  return (
    <div className='flex flex-col'>
      <EmbedRecordHeader recordId={branded} />
      <div className='p-3'>
        <CompactFieldList recordId={branded} />
      </div>
    </div>
  )
}
