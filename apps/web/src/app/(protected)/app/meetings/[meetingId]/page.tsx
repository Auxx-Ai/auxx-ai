// apps/web/src/app/(protected)/app/meetings/[meetingId]/page.tsx

import { DetailView } from '~/components/detail-view'

/**
 * Route params for the Meeting detail page.
 */
type Props = { params: Promise<{ meetingId: string }> }

/**
 * Meeting detail page using the universal DetailView component.
 */
async function MeetingDetailPage({ params }: Props) {
  const { meetingId } = await params
  return <DetailView apiSlug='meeting' instanceId={meetingId} />
}

export default MeetingDetailPage
