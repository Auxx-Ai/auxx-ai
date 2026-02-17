// apps/web/src/app/admin/organizations/[id]/_components/members-section.tsx
'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { UsersTable } from '~/app/admin/users/_components/users-table'

/** Props for the MembersSection component */
interface MembersSectionProps {
  organizationId: string
}

/** Organization members section — wraps the shared UsersTable with org locked */
export function MembersSection({ organizationId }: MembersSectionProps) {
  return (
    <Card className='md:col-span-2 border-none rounded-none shadow-none flex-1 flex flex-col'>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Organization team members and their roles</CardDescription>
      </CardHeader>
      <CardContent className='p-0 flex flex-1 flex-col'>
        <UsersTable organizationId={organizationId} pageSize={10} />
      </CardContent>
    </Card>
  )
}
