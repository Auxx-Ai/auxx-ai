// apps/web/src/app/(protected)/app/settings/channels/_components/integration-settings-advanced.tsx

'use client'

import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { ToggleCard } from '@auxx/ui/components/toggle-card'
import {
  Ban,
  Eye,
  MailMinus,
  MailPlus,
  MousePointerClick,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { api } from '~/trpc/react'
import { EmailFilterSection } from './email-list-dialog'

/** Provider types that can send outgoing email and support open/click tracking. */
const EMAIL_TRACKING_PROVIDERS = new Set(['google', 'outlook', 'email'])

interface IntegrationSettingsAdvancedProps {
  integration: {
    id: string
    provider: string
    settings?: {
      recordCreation?: {
        mode: 'all' | 'selective' | 'none'
      }
      excludeSenders?: string[]
      excludeRecipients?: string[]
      onlyProcessRecipients?: string[]
      tracking?: {
        opens?: boolean
        clicks?: boolean
      }
    }
    [key: string]: any
  }
  /** Admin, or owner of this personal channel — mutating controls disable otherwise. */
  canManage: boolean
}

/**
 * Advanced settings component with Record Creation and Email Filtering configuration.
 */
export default function IntegrationSettingsAdvanced({
  integration,
  canManage,
}: IntegrationSettingsAdvancedProps) {
  const utils = api.useUtils()
  const updateSettings = api.channel.updateSettings.useMutation({
    onSuccess: () => {
      utils.channel.list.invalidate()
      toastSuccess({
        title: 'Settings updated',
        description: 'Integration settings have been updated successfully',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error updating settings', description: error.message })
    },
  })
  const [recordCreationMode, setRecordCreationMode] = useState<'all' | 'selective' | 'none'>(
    integration?.settings?.recordCreation?.mode ?? 'selective'
  )

  useEffect(() => {
    if (integration?.settings?.recordCreation?.mode) {
      setRecordCreationMode(integration.settings.recordCreation.mode)
    }
  }, [integration?.settings?.recordCreation?.mode])

  const handleRecordCreationChange = async (value: 'all' | 'selective' | 'none') => {
    setRecordCreationMode(value)

    await updateSettings.mutateAsync({
      integrationId: integration.id,
      settings: {
        recordCreation: {
          mode: value,
        },
      },
    })
  }

  const saveFilterSetting = (key: string, entries: string[]) => {
    updateSettings.mutate({
      integrationId: integration.id,
      settings: { [key]: entries },
    })
  }

  // Email open/click tracking — only meaningful for channels that send outgoing
  // email. Defaults: opens on for all email providers; clicks on only for the
  // `email` (forwarding) provider — link-wrapping 1:1 personal mail (google/
  // outlook) is a deliverability risk, so it's opt-in there.
  const showTracking = EMAIL_TRACKING_PROVIDERS.has(integration.provider)
  const [trackOpens, setTrackOpens] = useState<boolean>(
    integration.settings?.tracking?.opens ?? true
  )
  const [trackClicks, setTrackClicks] = useState<boolean>(
    integration.settings?.tracking?.clicks ?? integration.provider === 'email'
  )

  // updateSettings merges shallowly at the top level, so a partial `tracking`
  // object would overwrite (not merge into) the previously saved one. Always
  // send both fields together to avoid clobbering the sibling toggle.
  const handleTrackOpensChange = (next: boolean) => {
    setTrackOpens(next)
    updateSettings.mutate({
      integrationId: integration.id,
      settings: { tracking: { opens: next, clicks: trackClicks } },
    })
  }
  const handleTrackClicksChange = (next: boolean) => {
    setTrackClicks(next)
    updateSettings.mutate({
      integrationId: integration.id,
      settings: { tracking: { opens: trackOpens, clicks: next } },
    })
  }

  return (
    <div className='space-y-4 sm:space-y-10 p-3 sm:p-6'>
      {/* Record Creation */}
      <SettingsSection
        icon={MailPlus}
        title='Record Creation'
        description='Manage how records will be created.'>
        <RadioGroup
          value={recordCreationMode}
          onValueChange={handleRecordCreationChange}
          disabled={!canManage || updateSettings.isPending}>
          <RadioGroupItemCard
            label='All contacts'
            value='all'
            icon={<Users />}
            description='Records will be created for all contacts who appear in the messages of your members.'
          />
          <RadioGroupItemCard
            label='Selective contact creation'
            value='selective'
            icon={<UserCheck />}
            description='Records will only be created for contacts who receive messages from your members, preventing spam from polluting your contacts.'
          />
          <RadioGroupItemCard
            label='None'
            value='none'
            icon={<UserX />}
            description='No records will automatically be created. Message events will still be associated with records created manually.'
          />
        </RadioGroup>
      </SettingsSection>

      {/* Email Tracking — only for channels that send outgoing email */}
      {showTracking && (
        <SettingsSection
          icon={Eye}
          title='Email Tracking'
          description='Track engagement on outgoing emails sent from this channel.'>
          <div className='space-y-2'>
            <ToggleCard
              icon={<Eye className='size-3.5' />}
              title='Track email opens'
              description='Add an invisible open-tracking pixel to outgoing emails.'
              checked={trackOpens}
              onCheckedChange={handleTrackOpensChange}
              disabled={!canManage || updateSettings.isPending}
            />
            <ToggleCard
              icon={<MousePointerClick className='size-3.5' />}
              title='Track link clicks'
              description='Rewrite links in outgoing emails through a tracking redirect.'
              checked={trackClicks}
              onCheckedChange={handleTrackClicksChange}
              disabled={!canManage || updateSettings.isPending}
            />
          </div>
        </SettingsSection>
      )}

      {/* Email Filtering Rules */}
      <EmailFilterSection
        icon={<Ban className='size-4' />}
        title='Exclude Senders'
        description='Add an email (e.g. user@example.com) or a domain (e.g. example.com) to auto-mark incoming emails from those senders as ignored.'
        emptyHint='No senders excluded'
        dialogTitle='Exclude Senders'
        dialogDescription='Emails from these senders will be automatically ignored. Add emails or domains.'
        entries={integration.settings?.excludeSenders ?? []}
        onSave={(entries) => saveFilterSetting('excludeSenders', entries)}
        isPending={updateSettings.isPending}
        disabled={!canManage}
      />

      <EmailFilterSection
        icon={<MailMinus className='size-4' />}
        title='Exclude Recipients'
        description='Add an email or domain to auto-mark incoming emails that were sent to those addresses as ignored. Useful for filtering mailing lists or shared aliases.'
        emptyHint='No recipients excluded'
        dialogTitle='Exclude Recipients'
        dialogDescription='Emails sent to these addresses will be automatically ignored. Add emails or domains.'
        entries={integration.settings?.excludeRecipients ?? []}
        onSave={(entries) => saveFilterSetting('excludeRecipients', entries)}
        isPending={updateSettings.isPending}
        disabled={!canManage}
      />

      <EmailFilterSection
        icon={<ShieldCheck className='size-4' />}
        title='Only Process Recipients'
        description='When set, only emails where the TO field matches one of these addresses will be processed. All other emails are auto-marked as ignored.'
        emptyHint='Disabled — all recipients processed'
        dialogTitle='Only Process Recipients'
        dialogDescription='Only emails sent to these addresses will be processed. Everything else will be ignored.'
        entries={integration.settings?.onlyProcessRecipients ?? []}
        onSave={(entries) => saveFilterSetting('onlyProcessRecipients', entries)}
        isPending={updateSettings.isPending}
        disabled={!canManage}
        activeWarning='All emails not matching these addresses will be automatically ignored.'
      />
    </div>
  )
}
