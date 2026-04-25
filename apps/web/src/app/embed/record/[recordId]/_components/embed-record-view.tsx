// apps/web/src/app/embed/record/[recordId]/_components/embed-record-view.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { CompactFieldList } from '~/components/fields/compact-field-list'
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
 */
export function EmbedRecordView({ recordId }: EmbedRecordViewProps) {
  const branded = recordId as RecordId
  return (
    <div className='flex flex-col'>
      <EmbedRecordHeader recordId={branded} />
      <div className='p-3'>
        <CompactFieldList recordId={branded} />
      </div>
    </div>
  )
}
