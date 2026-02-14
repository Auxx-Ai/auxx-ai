// apps/web/src/components/workflow/credentials/node-credential-button.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { AlertCircle, CheckCircle, Key, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { getCredentialType } from './credential-registry'
import { NodeCredentialConnectionDialog } from './node-credential-connection-dialog'

interface NodeCredentialButtonProps {
  /** Array of credential type IDs allowed for this node */
  allowedCredentialTypes: string[]

  /** Current node ID */
  nodeId: string

  /** Currently connected credential ID */
  currentCredentialId?: string | null

  /** Callback when credential is connected */
  onCredentialConnected: (credentialId: string) => void

  /** Callback when credential is disconnected */
  onCredentialDisconnected: () => void

  /** Button styling variants */
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string

  /** Custom button text overrides */
  buttonText?: string
  hideCreateOption?: boolean

  /** Disable the button */
  disabled?: boolean
}

/**
 * Node credential connection button component
 * Handles credential connection state and provides connection dialog
 */
export function NodeCredentialButton({
  allowedCredentialTypes,
  nodeId,
  currentCredentialId,
  onCredentialConnected,
  onCredentialDisconnected,
  variant = 'outline',
  size = 'sm',
  className,
  buttonText,
  hideCreateOption = false,
  disabled = false,
}: NodeCredentialButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  // Get credential info if connected
  const { data: credentialInfo, isLoading: isLoadingCredential } = api.credentials.getInfo.useQuery(
    { id: currentCredentialId! },
    {
      enabled: !!currentCredentialId,
      refetchOnWindowFocus: false,
    }
  )

  // Determine connection state
  const connectionState = useMemo(() => {
    if (isLoadingCredential) return 'loading'
    if (currentCredentialId && credentialInfo) return 'connected'
    if (currentCredentialId && !credentialInfo) return 'error'
    return 'disconnected'
  }, [currentCredentialId, credentialInfo, isLoadingCredential])

  // Get credential type info for display
  const credentialTypeInfo = useMemo(() => {
    if (!credentialInfo) return null
    return getCredentialType(credentialInfo.type)
  }, [credentialInfo])

  // Generate button content based on state
  const getButtonContent = () => {
    switch (connectionState) {
      case 'loading':
        return {
          text: 'Loading...',
          icon: Key,
          variant: 'ghost' as const,
          disabled: true,
        }

      case 'connected': {
        const credentialName = credentialInfo?.name || 'Unknown'
        const displayName = credentialTypeInfo?.displayName || credentialInfo?.type || 'Credential'
        return {
          text: buttonText || `Connected: ${credentialName}`,
          icon: CheckCircle,
          variant: 'default' as const,
          disabled: false,
          badge: displayName,
        }
      }

      case 'error':
        return {
          text: 'Connection Error',
          icon: AlertCircle,
          variant: 'destructive' as const,
          disabled: false,
        }

      default: // disconnected
        return {
          text: buttonText || 'Connect Credential',
          icon: Key,
          variant: variant,
          disabled: false,
        }
    }
  }

  const buttonContent = getButtonContent()

  const handleButtonClick = () => {
    if (connectionState === 'connected') {
      // Show connection options (edit/disconnect)
      setDialogOpen(true)
    } else {
      // Show connection dialog
      setDialogOpen(true)
    }
  }

  return (
    <>
      <div className='flex items-center gap-2'>
        <Button
          variant={buttonContent.variant}
          size={size}
          onClick={handleButtonClick}
          disabled={disabled || buttonContent.disabled}
          className={className}>
          <buttonContent.icon className='w-4 h-4' />
          {buttonContent.text}
        </Button>

        {buttonContent.badge && (
          <Badge variant='secondary' className='text-xs'>
            {buttonContent.badge}
          </Badge>
        )}

        {connectionState === 'connected' && (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setDialogOpen(true)}
            className='p-1 h-auto'
            title='Credential settings'>
            <Settings className='w-3 h-3' />
          </Button>
        )}
      </div>

      <NodeCredentialConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        nodeId={nodeId}
        allowedCredentialTypes={allowedCredentialTypes}
        currentCredentialId={currentCredentialId}
        onCredentialConnected={onCredentialConnected}
        onCredentialDisconnected={onCredentialDisconnected}
        hideCreateOption={hideCreateOption}
      />
    </>
  )
}
