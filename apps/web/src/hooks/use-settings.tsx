import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDehydratedSettings, useSettingsCatalog } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'

// Type for setting values
type SettingValue = string | number | boolean | object | null

interface UseSettingsOptions {
  // organizationId: string
  scope?: string
}

/**
 * React hook for managing application settings with organization defaults and user overrides
 *
 * @param scope - Optional scope to filter settings (e.g., 'APPEARANCE', 'NOTIFICATION')
 * @returns Object with settings data and methods to read/update settings
 */
export function useSettings({ scope }: UseSettingsOptions) {
  // Get the tRPC API hooks
  const utils = api.useUtils()

  // Use dehydrated settings catalog and user settings
  const settingsCatalog = useSettingsCatalog()
  const allUserSettings = useDehydratedSettings()

  // Filter settings by scope if needed
  const userSettings = useMemo(() => {
    if (!scope) return allUserSettings

    const filtered: Record<string, any> = {}
    Object.entries(allUserSettings).forEach(([key, value]) => {
      if (settingsCatalog[key]?.scope === scope) {
        filtered[key] = value
      }
    })
    return filtered
  }, [allUserSettings, settingsCatalog, scope])

  const [settings, setSettings] = useState<Record<string, SettingValue>>(userSettings)

  // Update settings state when userSettings changes
  useEffect(() => {
    setSettings(userSettings)
  }, [userSettings])

  // Hook for updating a user setting
  const updateUserSettingMutation = api.setting.updateUserSetting.useMutation({})

  // Effect to handle success for update mutations
  useEffect(() => {
    if (updateUserSettingMutation.isSuccess) {
      // Invalidate queries to refresh the data
      utils.setting.getAllUserSettings.invalidate({ scope })
    }
  }, [updateUserSettingMutation.isSuccess, utils.setting.getAllUserSettings, scope])

  // Effect to handle errors for update mutations
  useEffect(() => {
    if (updateUserSettingMutation.isError) {
      toastError({
        title: 'Failed to update setting',
        description: updateUserSettingMutation.error?.message || 'An error occurred',
      })
    }
  }, [updateUserSettingMutation.isError, updateUserSettingMutation.error])

  // Hook for resetting a user setting to org default
  const resetUserSettingMutation = api.setting.resetUserSetting.useMutation({})

  // Effect to handle success for reset mutations
  useEffect(() => {
    if (resetUserSettingMutation.isSuccess) {
      // Invalidate queries to refresh the data
      utils.setting.getAllUserSettings.invalidate({ scope })
    }
  }, [resetUserSettingMutation.isSuccess, utils.setting.getAllUserSettings, scope])

  // Effect to handle errors for reset mutations
  useEffect(() => {
    if (resetUserSettingMutation.isError) {
      toastError({
        title: 'Failed to reset setting',
        description: resetUserSettingMutation.error?.message || 'An error occurred',
      })
    }
  }, [resetUserSettingMutation.isError, resetUserSettingMutation.error])

  // Only for admins: update organization settings
  const updateOrgSettingMutation = api.setting.updateOrganizationSetting.useMutation({})

  // Effect to handle success for org setting updates
  useEffect(() => {
    if (updateOrgSettingMutation.isSuccess) {
      // Invalidate queries to refresh the data
      utils.setting.getAllUserSettings.invalidate({ scope })
      utils.setting.getOrganizationSettingsWithMetadata.invalidate({ scope })
    }
  }, [
    updateOrgSettingMutation.isSuccess,
    utils.setting.getAllUserSettings,
    utils.setting.getOrganizationSettingsWithMetadata,
    scope,
  ])

  // Effect to handle errors for org setting updates
  useEffect(() => {
    if (updateOrgSettingMutation.isError) {
      toastError({
        title: 'Failed to update organization setting',
        description: updateOrgSettingMutation.error?.message || 'An error occurred',
      })
    }
  }, [updateOrgSettingMutation.isError, updateOrgSettingMutation.error])

  // Batch update organization settings (for admins)
  const batchUpdateOrgSettingsMutation = api.setting.batchUpdateOrganizationSettings.useMutation({})

  // Effect to handle success for batch updates
  useEffect(() => {
    if (batchUpdateOrgSettingsMutation.isSuccess) {
      // Invalidate queries to refresh the data
      utils.setting.getAllUserSettings.invalidate({ scope })
      utils.setting.getOrganizationSettingsWithMetadata.invalidate({ scope })
      toastSuccess({
        title: 'Settings updated',
        description: 'Organization settings have been updated successfully',
      })
    }
  }, [
    batchUpdateOrgSettingsMutation.isSuccess,
    utils.setting.getAllUserSettings,
    utils.setting.getOrganizationSettingsWithMetadata,
    scope,
  ])

  // Effect to handle errors for batch updates
  useEffect(() => {
    if (batchUpdateOrgSettingsMutation.isError) {
      toastError({
        title: 'Failed to update organization settings',
        description: batchUpdateOrgSettingsMutation.error?.message || 'An error occurred',
      })
    }
  }, [batchUpdateOrgSettingsMutation.isError, batchUpdateOrgSettingsMutation.error])

  // Get organization settings with metadata (for admins)
  const { data: orgSettingsWithMetadata } =
    api.setting.getOrganizationSettingsWithMetadata.useQuery({ scope })

  // Helper function to get a specific setting
  const getSetting = useCallback(
    (key: string): SettingValue => {
      if (settings && settings[key] !== undefined) {
        return settings[key]
      }

      // Fallback to catalog default
      if (settingsCatalog?.[key]) {
        return settingsCatalog[key].defaultValue
      }

      return null
    },
    [settings, settingsCatalog]
  )

  // Helper function to update a user setting
  const updateUserSetting = useCallback(
    (key: string, value: SettingValue) => {
      // if (!organizationId) return
      // console.log('Updating user setting:', key, value)
      updateUserSettingMutation.mutate({ key, value })

      // Optimistically update the local state
      setSettings((prev) => ({ ...prev, [key]: value }))
    },
    [updateUserSettingMutation]
  )

  // Helper function to reset a user setting to org default
  const resetUserSetting = useCallback(
    (key: string) => {
      // if (!organizationId) return

      resetUserSettingMutation.mutate({ key })
    },
    [resetUserSettingMutation]
  )

  // Helper function to update an organization setting (admin only)
  const updateOrganizationSetting = useCallback(
    (key: string, value: SettingValue, allowUserOverride: boolean) => {
      // if (!organizationId) return

      updateOrgSettingMutation.mutate({ key, value, allowUserOverride })
    },
    [updateOrgSettingMutation]
  )

  // Helper function to batch update organization settings (admin only)
  const batchUpdateOrganizationSettings = useCallback(
    (
      settings: Array<{
        key: string
        value: SettingValue
        allowUserOverride: boolean
      }>
    ) => {
      // if (!organizationId) return

      batchUpdateOrgSettingsMutation.mutate({ settings })
    },
    [batchUpdateOrgSettingsMutation]
  )

  return {
    // Data
    settings,
    settingsCatalog,
    orgSettingsWithMetadata,
    isLoading: false, // Settings are always available from dehydrated state

    // Actions
    getSetting,
    updateUserSetting,
    resetUserSetting,
    updateOrganizationSetting,
    batchUpdateOrganizationSettings,

    // Mutation states
    isUpdatingUserSetting: updateUserSettingMutation.isPending,
    isResettingUserSetting: resetUserSettingMutation.isPending,
    isUpdatingOrgSetting: updateOrgSettingMutation.isPending,
    isBatchUpdatingOrgSettings: batchUpdateOrgSettingsMutation.isPending,
  }
}
