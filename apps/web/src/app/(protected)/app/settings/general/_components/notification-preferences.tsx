// apps/web/src/app/(protected)/app/settings/general/_components/notification-preferences.tsx
'use client'

import { FieldPanel } from '~/components/global/forms/field-panel'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'

/**
 * Notification sound preferences. Renders only the chosen sound toggles — the
 * rest of the NOTIFICATION scope (emailDigest, future keys) stays UI-less by
 * design. Values are stored per-user via the settings service.
 */
export function NotificationPreferences(): JSX.Element {
  return (
    <div className='space-y-2'>
      <h2 className='text-sm font-medium leading-none'>Notifications</h2>
      <p className='text-[0.8rem] text-muted-foreground'>Choose which alerts play a sound.</p>
      <FieldPanel className='mt-1 p-0' resizeId='notification-preferences' defaultLabelWidth={220}>
        <SettingsFieldRow settingKey='notification.sound.newMessage' title='New message sound' />
        <SettingsFieldRow settingKey='notification.sound.bell' title='Notification sound' />
      </FieldPanel>
    </div>
  )
}
