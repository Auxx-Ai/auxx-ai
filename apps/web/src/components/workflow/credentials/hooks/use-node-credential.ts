// apps/web/src/components/workflow/credentials/hooks/use-node-credential.ts

import { useMemo } from 'react'
import { useNodeCrud } from '~/components/workflow/hooks'
import type { BaseNodeData } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { getCredentialType } from '../credential-registry'

interface UseNodeCredentialOptions {
  /** Node ID */
  nodeId: string
  /** Current node data */
  nodeData: BaseNodeData
}

interface UseNodeCredentialReturn {
  /** Currently connected credential ID */
  credentialId: string | null

  /** Credential information if connected */
  credentialInfo: {
    id: string
    name: string
    type: string
    createdBy: { name: string | null }
    createdAt: Date
  } | null

  /** Credential type metadata */
  credentialTypeInfo: ReturnType<typeof getCredentialType>

  /** Connection state */
  isConnected: boolean
  isLoading: boolean
  hasError: boolean
  error: string | null

  /** Actions */
  connect: (credentialId: string) => void
  disconnect: () => void

  /** Helper to check if credential is valid for this node */
  isCredentialValid: boolean
}

/**
 * Hook for managing credential connections in workflow nodes
 * Provides credential info, connection state, and actions
 */
export function useNodeCredential({
  nodeId,
  nodeData,
}: UseNodeCredentialOptions): UseNodeCredentialReturn {
  const { inputs, setInputs } = useNodeCrud<BaseNodeData>(nodeId, nodeData)

  const credentialId = inputs.credentialId || null

  // Get credential info if connected
  const {
    data: credentialInfo,
    isLoading: isLoadingCredential,
    error: credentialError,
  } = api.credentials.getInfo.useQuery(
    { id: credentialId! },
    {
      enabled: !!credentialId,
      refetchOnWindowFocus: false,
      retry: 1,
    }
  )

  // Get credential type info
  const credentialTypeInfo = useMemo(() => {
    if (!credentialInfo) return null
    return getCredentialType(credentialInfo.type)
  }, [credentialInfo])

  // Connection state
  const isConnected = !!(credentialId && credentialInfo)
  const hasError = !!(credentialId && credentialError)
  const error = credentialError?.message || null

  // Check if credential is valid for this node type
  const isCredentialValid = useMemo(() => {
    if (!credentialTypeInfo || !nodeData.type) return true

    // If no compatibility specified, assume valid
    if (!credentialTypeInfo.compatibleNodeTypes) return true

    return credentialTypeInfo.compatibleNodeTypes.includes(nodeData.type)
  }, [credentialTypeInfo, nodeData.type])

  // Actions
  const connect = (newCredentialId: string) => {
    setInputs({ ...inputs, credentialId: newCredentialId })
  }

  const disconnect = () => {
    setInputs({ ...inputs, credentialId: null })
  }

  return {
    credentialId,
    credentialInfo: credentialInfo || null,
    credentialTypeInfo,
    isConnected,
    isLoading: isLoadingCredential,
    hasError,
    error,
    connect,
    disconnect,
    isCredentialValid,
  }
}

/**
 * Hook for checking credential compatibility with node types
 */
export function useCredentialCompatibility(nodeType: string) {
  const checkCompatibility = (credentialTypeId: string): boolean => {
    const credentialType = getCredentialType(credentialTypeId)
    if (!credentialType) return false

    // If no compatibility specified, assume compatible
    if (!credentialType.compatibleNodeTypes) return true

    return credentialType.compatibleNodeTypes.includes(nodeType)
  }

  return { checkCompatibility }
}
