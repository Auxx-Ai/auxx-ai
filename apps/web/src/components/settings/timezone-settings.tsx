// apps/web/src/components/settings/timezone-settings.tsx
'use client'

import { detectTimezone } from '@auxx/config/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { getCurrentTimeInTimezone } from '@auxx/utils/date'
import { Globe } from 'lucide-react'
import { useState } from 'react'
import { TimeZonePicker } from '~/components/pickers/timezone-picker'
import { useDehydratedStateContext } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

interface TimezoneSettingsProps {
  currentTimezone?: string | null
}

/**
 * Component for managing user's preferred timezone setting
 */
export function TimezoneSettings({ currentTimezone }: TimezoneSettingsProps) {
  const [selectedTimezone, setSelectedTimezone] = useState(currentTimezone || 'UTC')
  const [open, setOpen] = useState(false)
  const { patchUser } = useDehydratedStateContext()

  const updateTimezone = api.user.updateTimezone.useMutation({
    onSuccess: () => {
      patchUser({ preferredTimezone: selectedTimezone })
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update timezone',
        description: error.message,
      })
    },
  })

  const handleDetectTimezone = (e: React.MouseEvent) => {
    e.stopPropagation()
    const detected = detectTimezone()
    setSelectedTimezone(detected)
  }

  const handleSave = () => {
    updateTimezone.mutate({ timezone: selectedTimezone })
  }

  const hasChanges = selectedTimezone !== currentTimezone

  return (
    <div className='space-y-4'>
      <div>
        <label className='text-sm font-medium block'>Preferred Timezone</label>
        <p className='text-sm text-muted-foreground '>
          Select your timezone for displaying dates and times throughout the application.
        </p>
      </div>

      <div className='flex items-center gap-2'>
        <div className='flex-1'>
          <TimeZonePicker
            open={open}
            onOpenChange={setOpen}
            selected={selectedTimezone}
            onChange={setSelectedTimezone}>
            <div className='flex text-sm px-1 items-center justify-between rounded-lg border hover:border-gray-300 dark:bg-primary-100 dark:border-foreground/10 hover:bg-primary-100 focus-within:border-blue-500 focus-within:bg-background focus-within:ring-1 focus-within:ring-blue-500 shadow-xs h-8 border-primary-200 focus:border-primary-300 bg-primary-50 focus:ring-primary-400 focus-visible:ring-blue-500'>
              <div className='flex items-center gap-1.5'>
                <Globe className='size-4' />
                {selectedTimezone || 'Select timezone...'}
              </div>
              <Button
                type='button'
                size='xs'
                variant='outline'
                onClick={handleDetectTimezone}
                type='button'>
                Auto-detect
              </Button>
            </div>
          </TimeZonePicker>
        </div>

        {hasChanges && (
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              onClick={handleSave}
              type='button'
              loading={updateTimezone.isPending}
              loadingText='Saving...'>
              Save Timezone
            </Button>
            <Button
              size='sm'
              type='button'
              variant='ghost'
              onClick={() => setSelectedTimezone(currentTimezone || 'UTC')}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      <div className='text-sm text-muted-foreground'>
        <p>Current time in {selectedTimezone}:</p>
        <p className='font-medium mt-1'>{getCurrentTimeInTimezone(selectedTimezone, 'PPpp')}</p>
      </div>
    </div>
  )
}
