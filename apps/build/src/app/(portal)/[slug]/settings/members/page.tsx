// apps/build/src/app/(portal)/[slug]/settings/members/page.tsx

'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { Users } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import {
  useAuthenticatedUser,
  useDeveloperAccount,
} from '~/components/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import SettingsHeader from '../_components/settings-header'
import { InviteDialog } from './_components/invite-dialog'
import { MemberList } from './_components/member-list'

function MembersSettingsPage() {
  const params = useParams<{ slug: string }>()
  const user = useAuthenticatedUser()
  const account = useDeveloperAccount(params.slug)
  const [searchQuery, setSearchQuery] = useState('')

  const { data, isLoading } = api.members.list.useQuery(
    { developerSlug: params.slug },
    { enabled: !!params.slug }
  )

  const isAdmin = account?.userMember.accessLevel === 'admin'

  return (
    <>
      <SettingsHeader title='Members' icon={<Users className='size-4' />} />
      <div className='flex-1 overflow-y-auto min-h-0'>
        <div className='p-6 lg:py-12 max-w-3xl mx-auto'>
          <div className='flex flex-col space-y-6'>
            <div className='space-y-0'>
              <div className='text-xl font-semibold'>Members</div>
              <div className='text-base'>
                Manage developer account members, set access levels, and invite new users
              </div>
            </div>

            <div className='flex items-center justify-between gap-3'>
              <InputSearch
                placeholder='Search members...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery('')}
                className='max-w-xs'
              />
              {isAdmin && <InviteDialog developerSlug={params.slug} />}
            </div>

            {isLoading ? (
              <div className='text-sm text-muted-foreground py-8 text-center'>
                Loading members...
              </div>
            ) : data ? (
              <MemberList
                developerSlug={params.slug}
                currentUserId={user.id}
                currentMemberAccessLevel={account?.userMember.accessLevel ?? 'member'}
                members={data.members}
                invites={data.invites}
                searchQuery={searchQuery}
              />
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}

export default MembersSettingsPage
