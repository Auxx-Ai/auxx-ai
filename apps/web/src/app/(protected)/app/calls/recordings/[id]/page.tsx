// apps/web/src/app/(protected)/app/calls/recordings/[id]/page.tsx
'use client'

import { use } from 'react'
import { RecordingDetail } from '~/components/calls'

type Props = { params: Promise<{ id: string }> }

export default function RecordingDetailPage({ params }: Props) {
  const { id } = use(params)
  return <RecordingDetail recordingId={id} />
}
