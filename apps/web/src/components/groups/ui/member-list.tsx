// apps/web/src/components/groups/ui/member-list.tsx
'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { useGroup } from '../hooks'
import { getGroupMetadata } from '../utils'
import { EntityMemberList } from './entity-member-list'
import { UserMemberList } from './user-member-list'

/** Props for MemberList component */
interface MemberListProps {
  /** Group ID */
  groupId: string
  /** Whether user can manage members */
  canManage: boolean
}

/**
 * Members table wrapper component with tabs for users/entities
 * Adapts based on the group's memberType setting
 */
export function MemberList({ groupId, canManage }: MemberListProps) {
  const group = useGroup(groupId)
  const metadata = group ? getGroupMetadata(group) : {}
  const memberType = metadata.memberType || 'any'

  // If restricted to users only, show only user list
  if (memberType === 'user') {
    return <UserMemberList groupId={groupId} canManage={canManage} />
  }

  // If restricted to a specific entity type, show only entity list
  if (memberType !== 'any' && memberType !== 'user') {
    return <EntityMemberList groupId={groupId} entityType={memberType} canManage={canManage} />
  }

  // Show both tabs for 'any' memberType
  return (
    <Tabs defaultValue='users' className='w-full'>
      <TabsList className='mb-4'>
        <TabsTrigger value='users'>Users</TabsTrigger>
        <TabsTrigger value='entities'>Records</TabsTrigger>
      </TabsList>
      <TabsContent value='users'>
        <UserMemberList groupId={groupId} canManage={canManage} />
      </TabsContent>
      <TabsContent value='entities'>
        <EntityMemberList groupId={groupId} canManage={canManage} />
      </TabsContent>
    </Tabs>
  )
}
