// apps/web/src/app/(protected)/app/settings/channels/_components/integration-settings-advanced.tsx

'use client'

import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Ban, MailMinus, MailPlus, ShieldCheck, UserCheck, Users, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { EmailFilterSection } from './email-list-dialog'

interface IntegrationSettingsAdvancedProps {
  integration: {
    id: string
    settings?: {
      recordCreation?: {
        mode: 'all' | 'selective' | 'none'
      }
      excludeSenders?: string[]
      excludeRecipients?: string[]
      onlyProcessRecipients?: string[]
    }
    [key: string]: any
  }
}

/**
 * Advanced settings component with Record Creation and Email Filtering configuration.
 */
export default function IntegrationSettingsAdvanced({
  integration,
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

  return (
    <div className='space-y-10 p-6'>
      {/* Record Creation */}
      <div className='space-y-4'>
        <div className='space-y-1'>
          <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
            <MailPlus className='size-4' /> Record Creation
          </div>
          <p className='text-sm text-muted-foreground'>Manage how records will be created.</p>
        </div>

        <RadioGroup
          value={recordCreationMode}
          onValueChange={handleRecordCreationChange}
          disabled={updateSettings.isPending}>
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
      </div>

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
        activeWarning='All emails not matching these addresses will be automatically ignored.'
      />
    </div>
  )
}
