// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-styling.ts

import { hasOAuth2Config } from '@auxx/workflow-nodes/types'
import { Key } from 'lucide-react'
import { getCredentialType } from './credential-registry'

/**
 * Credential styling information
 */
export interface CredentialStyling {
  iconColor: string
  backgroundColor: string
  borderColor: string
  brandColor?: string
}

/**
 * Get styling information for a credential type
 * Uses the credential's own uiMetadata and OAuth2 providerStyling
 */
export function getCredentialStyling(credentialType: string): CredentialStyling {
  const metadata = getCredentialType(credentialType)
  const credential = metadata?.credentialType
  if (!credential) {
    // Fallback styling for unknown credential types
    return {
      iconColor: 'text-blue-500',
      backgroundColor: 'from-white to-gray-50',
      borderColor: 'border-gray-200',
    }
  }

  // Check if this is an OAuth2 credential with provider-specific styling
  const oauth2Styling = hasOAuth2Config(credential)
    ? credential.oauth2Config.providerStyling
    : undefined

  // Use OAuth2 styling if available, otherwise fall back to general uiMetadata
  const uiMetadata = credential.uiMetadata

  return {
    iconColor: oauth2Styling?.iconColor || uiMetadata?.iconColor || 'text-blue-500',
    backgroundColor:
      oauth2Styling?.backgroundColor || uiMetadata?.backgroundColor || 'from-white to-gray-50',
    borderColor: oauth2Styling?.borderColor || uiMetadata?.borderColor || 'border-gray-200',
    brandColor: oauth2Styling?.brandColor || uiMetadata?.brandColor,
  }
}

/**
 * Get the icon component for a credential type
 */
export function getCredentialIcon(credentialType: string): React.ComponentType<any> {
  const metadata = getCredentialType(credentialType)
  return metadata?.icon ?? Key
}

/**
 * Get display name for a credential type from registry
 */
export function getCredentialDisplayName(credentialType: string): string {
  const metadata = getCredentialType(credentialType)
  return metadata?.displayName || credentialType
}

/**
 * Get category for a credential type from registry
 */
export function getCredentialCategory(credentialType: string): string {
  const metadata = getCredentialType(credentialType)
  return metadata?.category || 'api'
}
