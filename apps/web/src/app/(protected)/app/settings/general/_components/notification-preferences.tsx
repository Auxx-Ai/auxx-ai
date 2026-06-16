// apps/web/src/app/(protected)/app/settings/general/_components/notification-preferences.tsx
'use client'

import { ToggleCard } from '@auxx/ui/components/toggle-card'
import { useSettings } from '~/hooks/use-settings'

/**
 * Notification sound preferences. Renders only the chosen sound toggles — the
 * rest of the NOTIFICATION scope (emailDigest, future keys) stays UI-less by
 * design. Values are stored per-user via the settings service.
 */
export function NotificationPreferences(): JSX.Element {
  const { getSetting, updateUserSetting } = useSettings({ scope: 'NOTIFICATION' })

  return (
    <div className='space-y-2'>
      <h2 className='text-sm font-medium leading-none'>Notifications</h2>
      <p className='text-[0.8rem] text-muted-foreground'>Choose which alerts play a sound.</p>
      <div className='space-y-2 pt-1'>
        <ToggleCard
          title='New message sound'
          description='Play a sound when a new message arrives (email + chat)'
          checked={getSetting('notification.sound.newMessage') as boolean}
          onCheckedChange={(v) => updateUserSetting('notification.sound.newMessage', v)}
        />
        <ToggleCard
          title='Notification sound'
          description='Play a sound for bell alerts (mentions, approvals)'
          checked={getSetting('notification.sound.bell') as boolean}
          onCheckedChange={(v) => updateUserSetting('notification.sound.bell', v)}
        />
      </div>
    </div>
  )
}
