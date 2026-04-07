// apps/web/src/app/(protected)/app/settings/aiModels/_components/provider-actions.tsx

'use client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { MoreVertical, Plus, Settings, Star, Trash2, Zap } from 'lucide-react'
import type React from 'react'

interface ProviderActionsProps {
  provider: string
  configured: boolean
  configStatus: string
  hasCustomCredentials?: boolean
  onSetup?: (provider: string) => void
  onEdit?: (provider: string) => void
  onMakeDefault?: (provider: string) => void
  onTestConnection?: (provider: string) => void
  onRemoveProvider?: (provider: string) => void
  onCreateCustomModel?: (provider: string) => void // Custom model creation
  disabled?: boolean
  className?: string
}

/**
 * Component to handle provider setup and configuration actions
 */
export const ProviderActions: React.FC<ProviderActionsProps> = ({
  provider,
  configured,
  configStatus,
  hasCustomCredentials,
  onSetup,
  onEdit,
  onMakeDefault,
  onTestConnection,
  onRemoveProvider,
  onCreateCustomModel,
  disabled = false,
  className,
}) => {
  const handleSetupClick = () => {
    onSetup?.(provider)
  }

  const handleEditClick = () => {
    onEdit?.(provider)
  }

  const handleMakeDefaultClick = () => {
    onMakeDefault?.(provider)
  }

  const handleTestConnectionClick = () => {
    onTestConnection?.(provider)
  }

  const handleCreateCustomModelClick = () => {
    onCreateCustomModel?.(provider)
  }

  const handleRemoveProviderClick = () => {
    onRemoveProvider?.(provider)
  }

  const handleAddModelClick = () => {
    // Open custom model creation dialog instead of dropdown
    onCreateCustomModel?.(provider)
  }

  // Show setup button if not configured
  if (!configured || configStatus === 'not_configured') {
    return (
      <Button
        variant='outline'
        size='xs'
        onClick={handleSetupClick}
        disabled={disabled}
        className={className}>
        <Plus />
        Setup
      </Button>
    )
  }

  // Show setup button for system-only providers without custom credentials
  if (configured && !hasCustomCredentials) {
    return (
      <div className='flex'>
        <Button
          variant='outline'
          size='xs'
          onClick={handleSetupClick}
          disabled={disabled}
          className='rounded-r-none'>
          <Plus />
          Setup
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='outline'
              size='xs'
              disabled={disabled}
              className='rounded-l-none border-l-0 w-6'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={handleMakeDefaultClick}>
              <Star />
              Make default
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTestConnectionClick}>
              <Zap />
              Test Connection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleCreateCustomModelClick}>
              <Plus />
              Create Custom Model
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  // Show action buttons if configured with custom credentials
  return (
    <div className='flex'>
      {/* Add Model Button */}
      <Button
        variant='outline'
        size='xs'
        disabled={disabled}
        onClick={handleAddModelClick}
        className='rounded-r-none'>
        <Plus />
        Add Model
      </Button>

      {/* Provider Actions Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='outline'
            size='xs'
            disabled={disabled}
            className='rounded-l-none border-l-0 w-6'>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={handleEditClick}>
            <Settings />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleMakeDefaultClick}>
            <Star />
            Make default
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleTestConnectionClick}>
            <Zap />
            Test Connection
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCreateCustomModelClick}>
            <Plus />
            Create Custom Model
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleRemoveProviderClick} variant='destructive'>
            <Trash2 />
            Remove Provider
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Get provider status display information
 */
export const getProviderStatusInfo = (configStatus: string) => {
  switch (configStatus) {
    case 'system_configured':
      return {
        label: 'System Configured',
        variant: 'green' as const,
        description: 'Using system configuration',
      }
    case 'custom_configured':
      return {
        label: 'Custom Configured',
        variant: 'blue' as const,
        description: 'Using custom configuration',
      }
    case 'quota_exceeded':
      return {
        label: 'Quota Exceeded',
        variant: 'yellow' as const,
        description: 'Usage quota has been exceeded',
      }
    case 'not_configured':
    default:
      return {
        label: 'Not Configured',
        variant: 'outline' as const,
        description: 'Provider needs to be configured',
      }
  }
}
