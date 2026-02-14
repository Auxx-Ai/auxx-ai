// apps/web/src/hooks/use-credential-test.ts

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * Hook for testing credentials and credential data
 */
export function useCredentialTest() {
  const testCredential = api.credentials.test.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toastSuccess({
          title: 'Credential Test Successful',
          description: result.message,
        })
      } else {
        toastError({
          title: 'Credential Test Failed',
          description: result.error?.message || result.message,
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Test Failed',
        description: error.message,
      })
    },
  })

  const testCredentialData = api.credentials.testData.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toastSuccess({
          title: 'Credential Validation Successful',
          description: result.message,
        })
      } else {
        toastError({
          title: 'Credential Validation Failed',
          description: result.error?.message || result.message,
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Validation Failed',
        description: error.message,
      })
    },
  })

  return {
    // Test an existing credential by ID
    testCredential: testCredential.mutateAsync,

    // Test credential data before saving (for validation during creation/editing)
    testCredentialData: testCredentialData.mutateAsync,

    // Loading states
    isTestingCredential: testCredential.isPending,
    isTestingCredentialData: testCredentialData.isPending,

    // Error states
    credentialTestError: testCredential.error,
    credentialDataTestError: testCredentialData.error,

    // Reset functions
    resetCredentialTest: testCredential.reset,
    resetCredentialDataTest: testCredentialData.reset,
  }
}
