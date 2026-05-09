// src/components/mail/thread-tag.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { RecordTagChip } from '~/components/tags/ui/record-tag-chip'

interface ThreadTagProps {
  /** The tag RecordId (format: "entityDefinitionId:instanceId") */
  tagId: RecordId
  /** The thread ID the tag is attached to (unused; kept for API compatibility) */
  threadId: string
  /** Callback to remove this tag from the thread */
  onRemove?: () => void
}

/**
 * @deprecated Use `RecordTagChip` from `~/components/tags/ui/record-tag-chip` directly.
 * This is a thin compatibility shim around `RecordTagChip` with `removeLabel='thread'`.
 */
export function ThreadTag({ tagId, threadId: _threadId, onRemove }: ThreadTagProps) {
  return <RecordTagChip tagId={tagId} removeLabel='thread' onRemove={onRemove} />
}
