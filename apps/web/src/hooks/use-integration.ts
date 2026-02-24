// ~/hooks/use-integration.ts

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * Custom hook for managing integrations
 * Provides methods to fetch, create, update, and delete integrations
 */
export const useIntegration = () => {
  const utils = api.useUtils()

  // Get all integrations for the organization
  const {
    data: integrations,
    refetch: refetchIntegrations,
    isLoading,
  } = api.integration.getIntegrations.useQuery()

  // Get OAuth URL for a specific provider
  const getAuthUrl = api.integration.getAuthUrl.useMutation({
    onError: (error) => {
      toastError({
        title: 'Error generating authentication URL',
        description: error.message,
      })
    },
  })

  // Disconnect an integration
  const disconnectIntegration = api.integration.disconnect.useMutation({
    onSuccess: () => {
      refetchIntegrations()
      utils.thread.getCounts.invalidate()
      toastSuccess({
        title: 'Integration disconnected',
        description: 'The integration was disconnected successfully',
      })
    },
    onError: (error) => {
      toastError({
        title: 'Error disconnecting integration',
        description: error.message,
      })
    },
  })

  // Toggle integration (enable/disable)
  const toggleIntegration = api.integration.toggle.useMutation({
    onSuccess: () => {
      refetchIntegrations()
      toastSuccess({
        title: 'Integration updated',
        description: 'The integration status was updated successfully',
      })
    },
    onError: (error) => {
      toastError({
        title: 'Error updating integration status',
        description: error.message,
      })
    },
  })

  // Sync messages for an integration
  const syncMessages = api.integration.syncMessages.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Sync started',
        description: 'The message sync process has been initiated',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error starting sync', description: error.message })
    },
  })

  // Add OpenPhone integration
  const addOpenPhoneIntegration = api.integration.addOpenPhoneIntegration.useMutation({
    onSuccess: () => {
      refetchIntegrations()
      toastSuccess({
        title: 'OpenPhone connected',
        description: 'Your OpenPhone account was connected successfully',
      })
    },
    onError: (error) => {
      toastError({
        title: 'Error connecting OpenPhone',
        description: error.message,
      })
    },
  })

  // Update integration settings
  const updateSettings = api.integration.updateSettings.useMutation({
    onSuccess: () => {
      refetchIntegrations()
      toastSuccess({
        title: 'Settings updated',
        description: 'Integration settings have been updated successfully',
      })
    },
    onError: (error) => {
      toastError({
        title: 'Error updating settings',
        description: error.message,
      })
    },
  })

  return {
    integrations,
    isLoading,
    getAuthUrl,
    disconnectIntegration,
    toggleIntegration,
    syncMessages,
    addOpenPhoneIntegration,
    updateSettings,
    refetchIntegrations,
  }
}
