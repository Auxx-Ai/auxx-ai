// apps/web/src/components/workflow/nodes/core/ai/tool-credential-status.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, CheckCircle, Shield } from 'lucide-react'
import { getToolCredentialRequirement } from './tool-credential-registry'

interface CredentialStatusIndicatorProps {
  toolId: string
  toolType: 'workflow_node' | 'built_in'
  nodeType?: string
  currentCredential?: string
  className?: string
}

/**
 * Component that shows credential status for a specific tool
 */
export function CredentialStatusIndicator({
  toolId,
  toolType,
  nodeType,
  currentCredential,
  className,
}: CredentialStatusIndicatorProps) {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement || requirement.requiredCredentialTypes.length === 0) {
    return null
  }

  const hasCredential = !!currentCredential
  const isRequired = requirement.isCredentialRequired

  if (isRequired && !hasCredential) {
    return (
      <div className={cn('flex items-center gap-1 text-destructive', className)}>
        <AlertTriangle className='h-3 w-3' />
        <span className='text-xs'>Auth required</span>
      </div>
    )
  }

  if (hasCredential) {
    return (
      <div className={cn('flex items-center gap-1 text-emerald-600', className)}>
        <CheckCircle className='h-3 w-3' />
        <span className='text-xs'>Authenticated</span>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-1 text-muted-foreground', className)}>
      <Shield className='h-3 w-3' />
      <span className='text-xs'>Optional auth</span>
    </div>
  )
}

/**
 * Badge variant for credential status
 */
export function CredentialStatusBadge({
  toolId,
  toolType,
  nodeType,
  currentCredential,
  className,
}: CredentialStatusIndicatorProps) {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement || requirement.requiredCredentialTypes.length === 0) {
    return null
  }

  const hasCredential = !!currentCredential
  const isRequired = requirement.isCredentialRequired

  if (isRequired && !hasCredential) {
    return (
      <Badge variant='destructive' className={cn('text-xs', className)}>
        Auth Required
      </Badge>
    )
  }

  if (hasCredential) {
    return (
      <Badge variant='default' className={cn('text-xs bg-emerald-100 text-emerald-800', className)}>
        Authenticated
      </Badge>
    )
  }

  return (
    <Badge variant='secondary' className={cn('text-xs', className)}>
      Optional
    </Badge>
  )
}

/**
 * Get credential status as string for display
 */
export function getCredentialStatusText(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string,
  currentCredential?: string
): string | null {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement || requirement.requiredCredentialTypes.length === 0) {
    return null
  }

  const hasCredential = !!currentCredential
  const isRequired = requirement.isCredentialRequired

  if (isRequired && !hasCredential) {
    return 'Auth Required'
  }

  if (hasCredential) {
    return 'Authenticated'
  }

  return 'Optional'
}

/**
 * Check if tool has credential issues that need attention
 */
export function hasCredentialIssue(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string,
  currentCredential?: string
): boolean {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement) return false

  const hasCredential = !!currentCredential
  const isRequired = requirement.isCredentialRequired

  // Issue if credential is required but not provided
  return isRequired && !hasCredential
}

/**
 * Get credential status info for a tool
 */
export function getToolCredentialStatus(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string,
  currentCredential?: string
) {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)

  if (!requirement) {
    return {
      hasRequirement: false,
      isRequired: false,
      hasCredential: false,
      hasIssue: false,
      statusText: null,
      description: null,
    }
  }

  const hasCredential = !!currentCredential
  const isRequired = requirement.isCredentialRequired
  const hasIssue = isRequired && !hasCredential

  return {
    hasRequirement: true,
    isRequired,
    hasCredential,
    hasIssue,
    statusText: getCredentialStatusText(toolId, toolType, nodeType, currentCredential),
    description: requirement.description,
    allowedCredentialTypes: requirement.requiredCredentialTypes,
  }
}
