// apps/web/src/app/(protected)/app/settings/groups/[groupId]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { GroupDetail } from '~/components/groups'

/** Group detail route. */
export default function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  return <GroupDetail groupId={groupId} />
}
