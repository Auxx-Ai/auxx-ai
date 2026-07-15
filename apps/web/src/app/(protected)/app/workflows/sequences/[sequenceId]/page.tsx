// apps/web/src/app/(protected)/app/workflows/sequences/[sequenceId]/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { useParams } from 'next/navigation'
import { EmptyState } from '~/components/global/empty-state'
import { SequenceDetailView } from '~/components/sequences/ui/detail/sequence-detail-view'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/** Thin route wrapper — all logic lives in the client detail view. */
export default function SequenceDetailPage() {
  const params = useParams<{ sequenceId: string }>()

  const { hasAccess } = useFeatureFlags()
  if (!hasAccess(FeatureKey.sequences)) return <EmptyState title='Page not found' />

  return <SequenceDetailView sequenceId={params?.sequenceId ?? ''} />
}
