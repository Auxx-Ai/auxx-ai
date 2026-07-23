// apps/web/src/app/(protected)/app/settings/members/[memberId]/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { MemberDetail } from '~/components/members'

/** Member detail route — `memberId` is the member's userId. */
export default function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  return <MemberDetail userId={memberId} />
}
