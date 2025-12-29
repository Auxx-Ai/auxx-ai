// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-styling.ts

// import * as lucideIcons from 'lucide-react'
import { getCredentialType } from './credential-registry'
import { hasOAuth2Config } from '@auxx/workflow-nodes/types'

/**
 * Credential styling information
 */
export interface CredentialStyling {
  iconColor: string
  backgroundColor: string
  borderColor: string
  icon: string
  brandColor?: string
}

/**
 * Get styling information for a credential type
 * Uses the credential's own uiMetadata and OAuth2 providerStyling
 */
export function getCredentialStyling(credentialType: string): CredentialStyling {
  const metadata = getCredentialType(credentialType)
  console.log('Credential metadata:', credentialType, metadata)
  const credential = metadata?.credentialType
  if (!credential) {
    // Fallback styling for unknown credential types
    return {
      iconColor: 'text-blue-500',
      backgroundColor: 'from-white to-gray-50',
      borderColor: 'border-gray-200',
      // icon: 'Key',
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
    icon: metadata.icon,
    brandColor: oauth2Styling?.brandColor || uiMetadata?.brandColor,
  }
}

/**
 * Get the Lucide icon component for a credential type
 */
export function getCredentialIcon(credentialType: string): React.ComponentType<any> {
  const styling = getCredentialStyling(credentialType)
  console.log('Credential icon styling:', styling)
  if (styling.icon) {
    return styling.icon as React.ComponentType<any>
  }
  console.log(credentialType)
  // Get the icon from lucide-react
  // const IconComponent = (lucideIcons as any)[styling.icon]

  // Fallback to Key icon if the specified icon doesn't exist
  // return IconComponent || lucideIcons.Key
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
