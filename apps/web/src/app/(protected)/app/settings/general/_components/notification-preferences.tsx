// apps/web/src/app/(protected)/app/settings/general/_components/notification-preferences.tsx
'use client'

import { FieldPanel } from '~/components/global/forms/field-panel'
import { SettingsFieldRow } from '~/components/settings/settings-field-row'

/**
 * Notification preferences: sound toggles + dispatch (field-service) email prefs
 * (plans/dispatch/19-client-notifications.md §4.9). Renders only these chosen keys — the
 * rest of the NOTIFICATION scope (emailDigest, future keys) stays UI-less by design. Values
 * are stored per-user via the settings service.
 */
export function NotificationPreferences(): JSX.Element {
  return (
    <div className='space-y-2'>
      <h2 className='text-sm font-medium leading-none'>Notifications</h2>
      <p className='text-[0.8rem] text-muted-foreground'>
        Choose which alerts play a sound or send an email.
      </p>
      <FieldPanel className='mt-1 p-0' resizeId='notification-preferences' defaultLabelWidth={220}>
        <SettingsFieldRow settingKey='notification.sound.newMessage' title='New message sound' />
        <SettingsFieldRow settingKey='notification.sound.bell' title='Notification sound' />
        <SettingsFieldRow
          settingKey='notification.dispatch.email'
          title='Dispatch reschedule/cancel/reassign emails'
        />
        <SettingsFieldRow
          settingKey='notification.dispatch.dailyDigest'
          title='Daily schedule digest email'
        />
      </FieldPanel>
    </div>
  )
}
