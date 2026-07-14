// apps/web/src/app/(protected)/app/workflows/sequences/[sequenceId]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { SequenceDetailView } from '~/components/sequences/ui/detail/sequence-detail-view'

/** Thin route wrapper — all logic lives in the client detail view. */
export default function SequenceDetailPage() {
  const params = useParams<{ sequenceId: string }>()
  return <SequenceDetailView sequenceId={params?.sequenceId ?? ''} />
}
