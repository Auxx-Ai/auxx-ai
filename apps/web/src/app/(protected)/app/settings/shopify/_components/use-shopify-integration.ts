'use client'

import { useState } from 'react'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'

/** Integration data type from the API */
// type ShopifyIntegration = { id: string; shopDomain: string; enabled: boolean; createdAt: Date }

/**
 * Custom hook for managing Shopify integrations
 * Encapsulates all Shopify-related API calls and handlers
 */
export function useShopifyIntegration() {
  const [isConnecting, setIsConnecting] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  // Get Shopify integrations query
  const {
    data: integrations,
    isLoading: isLoadingIntegrations,
    refetch,
  } = api.shopify.getIntegrations.useQuery()

  // Get auth URL mutation for connecting new stores
  const { mutate: getAuthUrl } = api.shopify.getAuthUrl.useMutation({
    onSuccess: (data) => {
      setIsConnecting(true)
      window.location.href = data.url
    },
    onError: (error) => {
      toastError({ title: 'Error connecting to Shopify', description: error.message })
      setIsConnecting(false)
    },
  })

  // Toggle integration enabled/disabled status
  const { mutate: toggleIntegrationMutation } = api.shopify.toggleIntegration.useMutation({
    onSuccess: () => {
      refetch()
      toastSuccess({
        title: 'Integration updated',
        description: 'The integration status has been updated successfully.',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error updating integration', description: error.message })
    },
  })

  // Sync products, orders, or customers
  const { mutateAsync: syncMutation, isPending: isSyncing } = api.shopify.sync.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Synced successfully',
        description: `Successfully synced from Shopify.`,
      })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error syncing', description: error.message })
    },
  })

  // Delete integration
  const { mutate: deleteIntegrationMutation } = api.shopify.deleteIntegration.useMutation({
    onSuccess: () => {
      refetch()
      toastSuccess({
        title: 'Integration deleted',
        description: 'The Shopify integration has been removed.',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error deleting integration', description: error.message })
    },
  })

  /**
   * Handle enabling/disabling an integration
   */
  const handleToggle = (integrationId: string, currentStatus: boolean) => {
    toggleIntegrationMutation({ integrationId, enabled: !currentStatus })
  }

  /**
   * Handle syncing data from Shopify
   */
  const handleSync = async (
    integrationId: string,
    type: 'products' | 'orders' | 'all' | 'customers'
  ) => {
    await syncMutation({ integrationId, type })
  }

  /**
   * Handle deleting an integration with confirmation
   */
  const handleDeleteIntegration = async (integrationId: string) => {
    const confirmed = await confirm({
      title: 'Delete Shopify integration?',
      description:
        'This action cannot be undone. The Shopify integration will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteIntegrationMutation({ integrationId })
    }
  }

  return {
    // Data
    integrations,
    isLoadingIntegrations,
    isConnecting,
    isSyncing,

    // Actions
    getAuthUrl,
    handleToggle,
    handleSync,
    handleDeleteIntegration,
    refetch,

    // Components
    ConfirmDialog,
  }
}
