'use client'
// ~/app/(protected)/app/settings/integrations/_components/integration-settings-advanced.tsx
import React, { useEffect, useState } from 'react'
import { MailPlus, Users, UserCheck, UserX } from 'lucide-react'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { useIntegration } from '~/hooks/use-integration'

interface IntegrationSettingsAdvancedProps {
  integration: {
    id: string
    settings?: {
      recordCreation?: {
        mode: 'all' | 'selective' | 'none'
      }
    }
    [key: string]: any
  }
}

/**
 * Advanced settings component with Record Creation configuration
 * for different integration types
 */
export default function IntegrationSettingsAdvanced({
  integration,
}: IntegrationSettingsAdvancedProps) {
  const { updateSettings } = useIntegration()
  const [recordCreationMode, setRecordCreationMode] = useState<'all' | 'selective' | 'none'>(
    integration?.settings?.recordCreation?.mode ?? 'selective' // Default to selective mode
  )

  useEffect(() => {
    if (integration?.settings?.recordCreation?.mode) {
      setRecordCreationMode(integration.settings.recordCreation.mode)
    }
  }, [integration?.settings?.recordCreation?.mode])

  const handleRecordCreationChange = async (value: 'all' | 'selective' | 'none') => {
    setRecordCreationMode(value)

    // Update settings in the backend
    await updateSettings.mutateAsync({
      integrationId: integration.id,
      settings: {
        recordCreation: {
          mode: value,
        },
      },
    })
  }

  return (
    <div className="space-y-10 p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
          <MailPlus className="size-4" /> Record Creation
        </div>
        <p className="text-sm text-muted-foreground">Manage how records will be created.</p>
      </div>

      <RadioGroup
        value={recordCreationMode}
        onValueChange={handleRecordCreationChange}
        disabled={updateSettings.isPending}>
        <RadioGroupItemCard
          label="All contacts"
          value="all"
          icon={<Users />}
          description="Records will be created for all contacts who appear in the messages of your members."
        />
        <RadioGroupItemCard
          label="Selective contact creation"
          value="selective"
          icon={<UserCheck />}
          description="Records will only be created for contacts who receive messages from your members, preventing spam from polluting your contacts."
        />
        <RadioGroupItemCard
          label="None"
          value="none"
          icon={<UserX />}
          description="No records will automatically be created. Message events will still be associated with records created manually."
        />
      </RadioGroup>
    </div>
  )
}
