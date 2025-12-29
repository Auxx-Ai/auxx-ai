// packages/credentials/src/types/provider-auth.ts

import type { ProviderAuth } from './index'
import type { NodeData, ICredentialType } from '@auxx/workflow-nodes/types'
import type { OAuth2Config } from '@auxx/workflow-nodes/types'

/**
 * Utility functions for transforming credentials to ProviderAuth format
 */

/**
 * Transform organization credential data to ProviderAuth
 * Uses the credential type's authenticate method if available
 */
// export function transformOrgCredentialToAuth(
//   credentialType: ICredentialType,
//   credentialData: NodeData
// ): ProviderAuth {
//   // Use credential type's authenticate method if available for transformations
//   const processedData = credentialType.authenticate
//     ? credentialType.authenticate(credentialData as Record<string, any>)
//     : credentialData

//   // Handle OAuth2 credentials
//   if (isOAuth2CredentialType(credentialType)) {
//     return transformOAuth2CredentialToAuth(processedData as Record<string, any>)
//   }

//   // Handle AWS S3 credentials
//   if (credentialType.name === 'S3') {
//     return transformS3CredentialToAuth(processedData as Record<string, any>)
//   }

//   // Handle SMTP credentials
//   if (credentialType.name === 'SMTP') {
//     return transformSmtpCredentialToAuth(processedData as Record<string, any>)
//   }

//   // Generic transformation - map common fields
//   return transformGenericCredentialToAuth(processedData as Record<string, any>)
// }

/**
 * Transform system credential data to ProviderAuth
 * Uses the credential type's systemCredentialMapping
 */
// export function transformSystemCredentialToAuth(
//   credentialType: ICredentialType,
//   systemData: Record<string, string>
// ): ProviderAuth {
//   // Handle OAuth2 credentials (system client credentials)
//   if (isOAuth2CredentialType(credentialType)) {
//     return transformOAuth2SystemCredentialToAuth(credentialType, systemData)
//   }

//   // Handle AWS S3 system credentials
//   if (credentialType.name === 'S3') {
//     return transformS3CredentialToAuth(systemData)
//   }

//   // Handle SMTP system credentials
//   if (credentialType.name === 'SMTP') {
//     return transformSmtpCredentialToAuth(systemData)
//   }

//   // Generic transformation
//   return transformGenericCredentialToAuth(systemData)
// }

/**
 * Check if credential type is OAuth2-based
 */
function isOAuth2CredentialType(credentialType: ICredentialType): boolean {
  return 'oauth2Config' in credentialType && credentialType.oauth2Config != null
}

/**
 * Transform OAuth2 credential to ProviderAuth
 */
// function transformOAuth2CredentialToAuth(credentialData: Record<string, any>): ProviderAuth {
//   return {
//     accessToken: credentialData.accessToken || credentialData.access_token,
//     refreshToken: credentialData.refreshToken || credentialData.refresh_token,
//     expiresAt: credentialData.expiresAt ? new Date(credentialData.expiresAt) : undefined,
//     accountEmail: credentialData.accountEmail || credentialData.email,
//     scopes: credentialData.scopes || [],
//     // Include any additional provider-specific fields
//     ...credentialData,
//   }
// }

/**
 * Transform OAuth2 system credentials (client credentials only)
 */
// function transformOAuth2SystemCredentialToAuth(
//   credentialType: ICredentialType,
//   systemData: Record<string, string>
// ): ProviderAuth {
//   const oauth2Config = (credentialType as any).oauth2Config as OAuth2Config

//   return {
//     clientId: systemData.clientId,
//     clientSecret: systemData.clientSecret,
//     scopes: oauth2Config.scopes || [],
//     authUrl: oauth2Config.authUrl,
//     tokenUrl: oauth2Config.tokenUrl,
//     redirectUri: systemData.redirectUri,
//     // Mark as system credential (no user tokens yet)
//     isSystemCredential: true,
//     ...systemData,
//   }
// }

/**
 * Transform S3 credential to ProviderAuth
 */
// function transformS3CredentialToAuth(credentialData: Record<string, any>): ProviderAuth {
//   return {
//     // Map S3 fields to ProviderAuth standard fields
//     accessToken: credentialData.accessKeyId,
//     secretKey: credentialData.secretAccessKey,
//     region: credentialData.region,
//     endpoint: credentialData.endpoint,
//     sessionToken: credentialData.sessionToken,
//     // Keep original S3 field names for adapter compatibility
//     accessKeyId: credentialData.accessKeyId,
//     secretAccessKey: credentialData.secretAccessKey,
//   }
// }

/**
 * Transform SMTP credential to ProviderAuth
 */
// function transformSmtpCredentialToAuth(credentialData: Record<string, any>): ProviderAuth {
//   return {
//     // Map SMTP fields
//     host: credentialData.host,
//     port: credentialData.port,
//     username: credentialData.username,
//     password: credentialData.password,
//     secure: credentialData.secure,
//     ignoreTLS: credentialData.ignoreTLS,
//     // For ProviderAuth compatibility, map username to accessToken
//     accessToken: credentialData.username,
//   }
// }

/**
 * Generic credential transformation
 * Maps common credential patterns to ProviderAuth
 */
// function transformGenericCredentialToAuth(credentialData: Record<string, any>): ProviderAuth {
//   const auth: ProviderAuth = {}

//   // Map common access token patterns
//   if (credentialData.accessToken || credentialData.access_token) {
//     auth.accessToken = credentialData.accessToken || credentialData.access_token
//   } else if (credentialData.token) {
//     auth.accessToken = credentialData.token
//   } else if (credentialData.apiKey || credentialData.api_key) {
//     auth.accessToken = credentialData.apiKey || credentialData.api_key
//   }

//   // Map refresh token patterns
//   if (credentialData.refreshToken || credentialData.refresh_token) {
//     auth.refreshToken = credentialData.refreshToken || credentialData.refresh_token
//   }

//   // Map expiry patterns
//   if (credentialData.expiresAt || credentialData.expires_at) {
//     const expires = credentialData.expiresAt || credentialData.expires_at
//     auth.expiresAt = typeof expires === 'string' ? new Date(expires) : expires
//   }

//   // Map account email patterns
//   if (credentialData.email || credentialData.accountEmail) {
//     auth.accountEmail = credentialData.email || credentialData.accountEmail
//   }

//   // Map scopes
//   if (credentialData.scopes) {
//     auth.scopes = Array.isArray(credentialData.scopes)
//       ? credentialData.scopes
//       : [credentialData.scopes]
//   }

//   // Include all original fields for provider-specific compatibility
//   return {
//     ...auth,
//     ...credentialData,
//   }
// }

/**
 * Validate ProviderAuth format
 */
// export function validateProviderAuth(auth: ProviderAuth): { isValid: boolean; errors: string[] } {
//   const errors: string[] = []

//   // Check if at least one authentication mechanism is present
//   const hasAccessToken = auth.accessToken && typeof auth.accessToken === 'string'
//   const hasCredentials = Object.keys(auth).some(
//     (key) =>
//       key !== 'accessToken' &&
//       key !== 'refreshToken' &&
//       key !== 'expiresAt' &&
//       key !== 'accountEmail' &&
//       key !== 'scopes' &&
//       auth[key] != null
//   )

//   if (!hasAccessToken && !hasCredentials) {
//     errors.push(
//       'ProviderAuth must contain at least an accessToken or provider-specific credentials'
//     )
//   }

//   // Validate expiry date if present
//   if (auth.expiresAt && !(auth.expiresAt instanceof Date)) {
//     errors.push('expiresAt must be a Date object')
//   }

//   // Validate scopes if present
//   if (auth.scopes && !Array.isArray(auth.scopes)) {
//     errors.push('scopes must be an array of strings')
//   }

//   return {
//     isValid: errors.length === 0,
//     errors,
//   }
// }

/**
 * Check if ProviderAuth appears to be expired
 */
export function isProviderAuthExpired(auth: ProviderAuth): boolean {
  if (!auth.expiresAt) return false
  return auth.expiresAt <= new Date()
}

/**
 * Check if ProviderAuth has refresh capability
 */
export function canRefreshProviderAuth(auth: ProviderAuth): boolean {
  return Boolean(auth.refreshToken)
}
