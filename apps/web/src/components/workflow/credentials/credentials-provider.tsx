// apps/web/src/app/(protected)/app/workflows/_components/providers/credentials-provider.tsx
'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'

interface CredentialListItem {
  id: string
  name: string
  type: string
  createdBy: { name: string | null }
  createdAt: Date
}

interface CreateCredentialData {
  type: string
  name: string
  data: Record<string, any>
}

interface UpdateCredentialData {
  name?: string
  data?: Record<string, any>
}

interface CredentialsContextType {
  // Data Management
  credentials: CredentialListItem[]
  isLoading: boolean
  error: string | null

  // Filtering & Search
  searchQuery: string
  selectedType: string | null
  viewMode: 'grid' | 'table'

  // Actions
  refetchCredentials: () => Promise<void>
  setSearchQuery: (query: string) => void
  setSelectedType: (type: string | null) => void
  setViewMode: (mode: 'grid' | 'table') => void

  // CRUD Operations
  createCredential: (data: CreateCredentialData) => Promise<string>
  updateCredential: (id: string, data: UpdateCredentialData) => Promise<void>
  deleteCredential: (id: string) => Promise<void>
  testCredential: (id: string) => Promise<boolean>
}

const CredentialsContext = createContext<CredentialsContextType | undefined>(undefined)

/**
 * Custom hook to use credentials context
 */
export function useCredentials() {
  const context = useContext(CredentialsContext)
  if (context === undefined) {
    throw new Error('useCredentials must be used within a CredentialsProvider')
  }
  return context
}

interface CredentialsProviderProps {
  children: React.ReactNode
}

/**
 * Credentials provider component
 */
export function CredentialsProvider({ children }: CredentialsProviderProps) {
  // State management
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  // API queries and mutations
  const {
    data: credentials = [],
    isLoading,
    error,
    refetch,
  } = api.credentials.list.useQuery(
    { type: undefined }, // Always fetch all credentials for workflow context
    {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    }
  )

  const createMutation = api.credentials.create.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Credential created successfully' })
      refetch()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to create credential',
        description: error.message,
      })
    },
  })

  const updateMutation = api.credentials.update.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Credential updated successfully' })
      refetch()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update credential',
        description: error.message,
      })
    },
  })

  const deleteMutation = api.credentials.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Credential deleted successfully' })
      refetch()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete credential',
        description: error.message,
      })
    },
  })

  const testMutation = api.credentials.test.useMutation({
    onError: (error) => {
      toastError({
        title: 'Credential test failed',
        description: error.message,
      })
    },
  })

  // Filter credentials based on search query
  const filteredCredentials = credentials.filter((credential) => {
    const matchesSearch =
      !searchQuery ||
      credential.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      credential.type.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesSearch
  })

  // Action handlers
  const refetchCredentials = useCallback(async () => {
    await refetch()
  }, [refetch])

  const createCredential = useCallback(
    async (data: CreateCredentialData): Promise<string> => {
      const result = await createMutation.mutateAsync(data)
      return result.id
    },
    [createMutation]
  )

  const updateCredential = useCallback(
    async (id: string, data: UpdateCredentialData): Promise<void> => {
      await updateMutation.mutateAsync({ id, ...data })
    },
    [updateMutation]
  )

  const deleteCredential = useCallback(
    async (id: string): Promise<void> => {
      await deleteMutation.mutateAsync({ id })
    },
    [deleteMutation]
  )

  const testCredential = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const result = await testMutation.mutateAsync({ id })
        if (result.success) {
          toastSuccess({ description: 'Credential test passed' })
        } else {
          toastError({
            title: 'Credential test failed',
            description: result.message || 'Unknown error',
          })
        }
        return result.success
      } catch (error) {
        return false
      }
    },
    [testMutation]
  )

  const contextValue: CredentialsContextType = {
    // Data
    credentials: filteredCredentials,
    isLoading,
    error: error?.message || null,

    // Filters
    searchQuery,
    selectedType,
    viewMode,

    // Actions
    refetchCredentials,
    setSearchQuery,
    setSelectedType,
    setViewMode,

    // CRUD
    createCredential,
    updateCredential,
    deleteCredential,
    testCredential,
  }

  return <CredentialsContext.Provider value={contextValue}>{children}</CredentialsContext.Provider>
}
