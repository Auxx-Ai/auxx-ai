// apps/web/src/app/(protected)/app/workflows/_components/tabs/credentials-tab-content.tsx
'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCredentials } from '~/components/workflow/credentials/credentials-provider'
import { CredentialsFilterBar } from '../filters/credentials-filter-bar'
import { CredentialsGridView } from '../views/credentials-grid-view'
import { CredentialsTableView } from '../views/credentials-table-view'
import { CredentialsEmptyState } from '../states/credentials-empty-state'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'

/**
 * Credentials tab content component
 */
export function CredentialsTabContent() {
  const {
    credentials,
    isLoading,
    searchQuery,
    selectedType,
    viewMode,
    setSearchQuery,
    setSelectedType,
    refreshCredentials,
  } = useCredentials()

  const searchParams = useSearchParams()

  // Handle OAuth success/error messages from URL parameters
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const credentialId = searchParams.get('credential_id')
    const userEmail = searchParams.get('user_email')
    const oauthError = searchParams.get('oauth_error')
    const errorDescription = searchParams.get('oauth_error_description')

    if (oauthSuccess === 'true') {
      toastSuccess({
        title: 'Authentication Successful',
        description: `Google OAuth2 credential connected successfully${userEmail ? ` as ${userEmail}` : ''}`,
      })

      // Refresh credentials list to show the new credential
      refreshCredentials?.()

      // Clean up URL parameters
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('oauth_success')
      newUrl.searchParams.delete('credential_id')
      newUrl.searchParams.delete('user_email')
      window.history.replaceState({}, '', newUrl.toString())
    }

    if (oauthError) {
      let errorTitle = 'Authentication Failed'
      let errorMessage = errorDescription || 'OAuth authentication failed'

      // Provide more specific error messages based on error type
      switch (oauthError) {
        case 'configuration_error':
          errorTitle = 'Configuration Error'
          errorMessage = 'OAuth configuration is incomplete. Please contact support.'
          break
        case 'token_error':
          errorTitle = 'Token Exchange Failed'
          errorMessage = 'Failed to exchange authorization code. Please try again.'
          break
        case 'processing_failed':
          errorTitle = 'Processing Failed'
          errorMessage = errorDescription || 'An unexpected error occurred during authentication.'
          break
        default:
          errorMessage = errorDescription || 'OAuth authentication failed. Please try again.'
      }

      toastError({ title: errorTitle, description: errorMessage })

      // Clean up URL parameters
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.delete('oauth_error')
      newUrl.searchParams.delete('oauth_error_description')
      window.history.replaceState({}, '', newUrl.toString())
    }
  }, [searchParams, refreshCredentials])

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedType(null)
  }

  return (
    <>
      {/* Filters and View Options */}
      <CredentialsFilterBar />

      {/* Credentials Content */}
      <div className="p-3 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-3/4 mb-1" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-16 w-full mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : credentials.length === 0 ? (
          <CredentialsEmptyState
            searchQuery={searchQuery}
            selectedType={selectedType}
            onClearFilters={handleClearFilters}
            onSelectType={(type) => {
              // TODO: Open create credential dialog with pre-selected type
              console.log('Select credential type:', type)
            }}
          />
        ) : viewMode === 'grid' ? (
          <CredentialsGridView />
        ) : (
          <CredentialsTableView />
        )}
      </div>
    </>
  )
}
