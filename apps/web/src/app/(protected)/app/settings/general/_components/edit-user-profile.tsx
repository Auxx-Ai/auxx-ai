// apps/web/src/app/(protected)/app/settings/general/_components/edit-user-profile.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Edit } from 'lucide-react'
import { useState } from 'react'
import { AvatarUpload } from '~/components/file-upload/ui/avatar-upload'
import { TimezoneSettings } from '~/components/settings/timezone-settings'
import { useUser } from '~/hooks/use-user'
import { useDehydratedUser } from '~/providers/dehydrated-state-provider'
import { EditNameDialog } from './edit-name-dialog'
import { NotificationPreferences } from './notification-preferences'

export function EditUserProfileForm(): JSX.Element {
  const { user } = useUser()
  const dehydratedUser = useDehydratedUser()
  const [nameDialogOpen, setNameDialogOpen] = useState(false)

  /**
   * Handle avatar upload completion
   */
  const handleAvatarUpload = (_assetId: string, _url: string) => {
    // TODO: Optionally trigger user data refresh or update user context
  }

  return (
    <div className='max-w-xl space-y-8'>
      <div className='space-y-2'>
        <h2 className='text-sm font-medium leading-none'>Photo</h2>
        <AvatarUpload
          currentAvatarUrl={user?.image || undefined}
          onUploadComplete={handleAvatarUpload}
          size='sm'
        />
      </div>

      {/* Name */}
      <div className='space-y-2'>
        <Label>Name</Label>
        <p className='text-[0.8rem] text-muted-foreground'>
          This is your public display name. It can be your real name or a pseudonym.
        </p>
        <div className='relative'>
          <Input
            value={user?.name || ''}
            readOnly
            className='bg-muted flex-1'
            placeholder='Your name'
          />
          <Button
            type='button'
            variant='outline'
            size='xs'
            onClick={() => setNameDialogOpen(true)}
            className='absolute right-1 top-1/2 -translate-y-1/2'>
            <Edit />
            Edit
          </Button>
        </div>
      </div>

      {/* Timezone */}
      <TimezoneSettings currentTimezone={dehydratedUser?.preferredTimezone} />

      {/* Notifications */}
      <NotificationPreferences />

      <EditNameDialog
        currentName={user?.name || ''}
        isOpen={nameDialogOpen}
        onOpenChange={setNameDialogOpen}
      />
    </div>
  )
}
