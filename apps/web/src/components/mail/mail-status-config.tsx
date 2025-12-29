// apps/web/src/components/mail/mail-status-config.ts
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Loader2,
  Mail,
  Phone,
  MessageSquare,
  AlertTriangle,
  Pause,
} from 'lucide-react'
import { GoogleIcon, OutlookIcon, FacebookIcon, InstagramIcon } from '~/constants/icons'
import { JobStatus, SendStatus, SYNC_STATUS, IntegrationAuthStatus } from '@auxx/database/enums'
// ============================================================================
// Processing Job Status Configuration
// ============================================================================
export const processingStatusConfig = {
  [JobStatus.PENDING]: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: Clock,
    label: 'Pending',
    description: 'Waiting to process',
    animate: false,
  },
  [JobStatus.PROCESSING]: {
    color: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Loader2,
    label: 'Processing',
    description: 'Currently processing',
    animate: true,
  },
  [JobStatus.COMPLETED_SUCCESS]: {
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: CheckCircle,
    label: 'Processed',
    description: 'Successfully processed',
    animate: false,
  },
  [JobStatus.COMPLETED_PARTIAL]: {
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    icon: AlertCircle,
    label: 'Partial',
    description: 'Partially processed',
    animate: false,
  },
  [JobStatus.COMPLETED_FAILURE]: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
    label: 'Failed',
    description: 'Processing failed',
    animate: false,
  },
  [JobStatus.FAILED]: {
    color: 'bg-red-100 text-red-800 border-red-200',
    icon: XCircle,
    label: 'Failed',
    description: 'Processing failed',
    animate: false,
  },
  [JobStatus.RETRYING]: {
    color: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: RefreshCw,
    label: 'Retrying',
    description: 'Retrying processing',
    animate: true,
  },
}
// ============================================================================
// Send Status Configuration
// ============================================================================
export const sendStatusConfig = {
  [SendStatus.PENDING]: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
    icon: Clock,
    label: 'Sending...',
    description: 'Message is being sent',
    animate: true,
  },
  [SendStatus.SENT]: {
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    label: 'Sent',
    description: 'Message sent successfully',
    animate: false,
  },
  [SendStatus.FAILED]: {
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Failed to send',
    description: 'Failed to send message',
    animate: false,
  },
}
// ============================================================================
// Sync Status Configuration
// ============================================================================
export const syncStatusConfig = {
  [SYNC_STATUS.PENDING]: {
    color: 'text-blue-500',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
    icon: Clock,
    label: 'Sync Pending',
    description: 'Waiting to start sync',
    animate: false,
  },
  [SYNC_STATUS.IN_PROGRESS]: {
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
    icon: Loader2,
    label: 'Syncing',
    description: 'Sync in progress',
    animate: true,
  },
  [SYNC_STATUS.COMPLETED]: {
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    label: 'Sync Complete',
    description: 'Sync completed successfully',
    animate: false,
  },
  [SYNC_STATUS.FAILED]: {
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Sync Failed',
    description: 'Sync failed',
    animate: false,
  },
}
// ============================================================================
// Integration Auth Status Configuration
// ============================================================================
export const integrationAuthStatusConfig = {
  [IntegrationAuthStatus.AUTHENTICATED]: {
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    label: 'Connected',
    variant: 'success' as const,
    description: 'Authentication successful',
  },
  [IntegrationAuthStatus.UNAUTHENTICATED]: {
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    borderColor: 'border-yellow-200',
    icon: AlertCircle,
    label: 'Not Authenticated',
    variant: 'secondary' as const,
    description: 'Authentication required',
  },
  [IntegrationAuthStatus.ERROR]: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Auth Error',
    variant: 'destructive' as const,
    description: 'Authentication error',
  },
  [IntegrationAuthStatus.INVALID_GRANT]: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: AlertTriangle,
    label: 'Invalid Grant',
    variant: 'destructive' as const,
    description: 'Re-authentication required',
  },
  [IntegrationAuthStatus.EXPIRED_TOKEN]: {
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    borderColor: 'border-orange-200',
    icon: AlertTriangle,
    label: 'Token Expired',
    variant: 'destructive' as const,
    description: 'Token expired - re-authentication required',
  },
  [IntegrationAuthStatus.REVOKED_ACCESS]: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Access Revoked',
    variant: 'destructive' as const,
    description: 'Access has been revoked',
  },
  [IntegrationAuthStatus.INSUFFICIENT_SCOPE]: {
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    borderColor: 'border-yellow-200',
    icon: AlertCircle,
    label: 'Insufficient Permissions',
    variant: 'secondary' as const,
    description: 'Additional permissions required',
  },
  [IntegrationAuthStatus.RATE_LIMITED]: {
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    borderColor: 'border-orange-200',
    icon: Clock,
    label: 'Rate Limited',
    variant: 'secondary' as const,
    description: 'Rate limit exceeded - try again later',
  },
  [IntegrationAuthStatus.PROVIDER_ERROR]: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Provider Error',
    variant: 'destructive' as const,
    description: 'Provider service error',
  },
  [IntegrationAuthStatus.NETWORK_ERROR]: {
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-900/30',
    borderColor: 'border-gray-200',
    icon: AlertCircle,
    label: 'Network Error',
    variant: 'secondary' as const,
    description: 'Network connection error',
  },
  [IntegrationAuthStatus.UNKNOWN_ERROR]: {
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-900/30',
    borderColor: 'border-gray-200',
    icon: AlertCircle,
    label: 'Unknown Error',
    variant: 'secondary' as const,
    description: 'An unknown error occurred',
  },
}
// ============================================================================
// Custom Integration Status Configuration (for UI states)
// ============================================================================
export const integrationStatusConfig = {
  authenticated: {
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    label: 'Connected',
    variant: 'success' as const,
    description: 'Authentication successful',
  },
  auth_error: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: AlertTriangle,
    label: 'Auth Required',
    variant: 'destructive' as const,
    description: 'Authentication failed - re-authentication required',
  },
  sync_error: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    borderColor: 'border-red-200',
    icon: XCircle,
    label: 'Sync Error',
    variant: 'destructive' as const,
    description: 'Sync failed - check connection',
  },
  disabled: {
    color: 'text-gray-500 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    borderColor: 'border-gray-200',
    icon: Pause,
    label: 'Disabled',
    variant: 'secondary' as const,
    description: 'Integration is currently disabled',
  },
  syncing: {
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    borderColor: 'border-blue-200',
    icon: RefreshCw,
    label: 'Syncing',
    variant: 'default' as const,
    description: 'Currently syncing',
    animate: true,
  },
}
// ============================================================================
// Unified Integration Configuration
// Single source of truth - all keys normalized to lowercase
// ============================================================================
// Default configuration for unknown integrations
const defaultIntegrationConfig = {
  icon: Mail,
  label: 'Integration',
  color: '#6B7280',
  bgColor: 'bg-gray-100',
  borderColor: 'border-gray-200',
}
// Base configuration - all keys lowercase for consistency
const baseIntegrationConfig = {
  google: {
    icon: GoogleIcon,
    label: 'Google',
    color: '#EA4335',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
  },
  gmail: {
    icon: GoogleIcon,
    label: 'Gmail',
    color: '#EA4335',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
  },
  outlook: {
    icon: OutlookIcon,
    label: 'Outlook',
    color: '#0078D4',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
  },
  microsoft: {
    icon: OutlookIcon,
    label: 'Microsoft',
    color: '#0078D4',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
  },
  facebook: {
    icon: FacebookIcon,
    label: 'Facebook',
    color: '#1877F2',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
  },
  instagram: {
    icon: InstagramIcon,
    label: 'Instagram',
    color: '#E4405F',
    bgColor: 'bg-pink-100',
    borderColor: 'border-pink-200',
  },
  openphone: {
    icon: Phone,
    label: 'OpenPhone',
    color: '#00C896',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  mailgun: {
    icon: Mail,
    label: 'Mailgun',
    color: '#FF5850',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
  },
  sms: {
    icon: MessageSquare,
    label: 'SMS',
    color: '#10B981',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  whatsapp: {
    icon: MessageSquare,
    label: 'WhatsApp',
    color: '#25D366',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  chat: {
    icon: MessageSquare,
    label: 'Chat',
    color: '#7C3AED',
    bgColor: 'bg-purple-100',
    borderColor: 'border-purple-200',
  },
  email: {
    icon: Mail,
    label: 'Email',
    color: '#6B7280',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
  },
} as const
// Export the config directly - consumers will normalize keys before lookup
export const integrationConfig = baseIntegrationConfig
// ============================================================================
// Helper Functions - NO SWITCH STATEMENTS!
// ============================================================================
/**
 * Normalize integration key for lookup
 * Handles IntegrationType (UPPERCASE), IntegrationProviderType (lowercase), and strings
 */
function normalizeIntegrationKey(key?: string | null): string {
  if (!key) return 'email' // default fallback
  return key.toLowerCase()
}
/**
 * Get integration configuration (with normalization)
 */
export function getIntegrationConfig(integration?: string | null) {
  const key = normalizeIntegrationKey(integration)
  return integrationConfig[key as keyof typeof integrationConfig] || defaultIntegrationConfig
}
/**
 * Get integration icon component
 */
export function getIntegrationIcon(integration?: string | null) {
  const config = getIntegrationConfig(integration)
  const Icon = config.icon
  return <Icon className="h-3 w-3" />
}
/**
 * Get integration icon constructor (for dynamic usage)
 */
export function getIntegrationIconClass(integration?: string | null) {
  const config = getIntegrationConfig(integration)
  return config.icon
}
/**
 * Get integration color
 */
export function getIntegrationColor(integration?: string | null): string {
  const config = getIntegrationConfig(integration)
  return config.color
}
/**
 * Get integration label
 */
export function getIntegrationLabel(integration?: string | null): string {
  const config = getIntegrationConfig(integration)
  return config.label
}
/**
 * Get integration background color class
 */
export function getIntegrationBgColor(integration?: string | null): string {
  const config = getIntegrationConfig(integration)
  return config.bgColor
}
/**
 * Get integration border color class
 */
export function getIntegrationBorderColor(integration?: string | null): string {
  const config = getIntegrationConfig(integration)
  return config.borderColor
}
// Type exports for component props
export type ProcessingStatusConfigType = typeof processingStatusConfig
export type SendStatusConfigType = typeof sendStatusConfig
export type SyncStatusConfigType = typeof syncStatusConfig
export type IntegrationAuthStatusConfigType = typeof integrationAuthStatusConfig
export type IntegrationStatusConfigType = typeof integrationStatusConfig
export type IntegrationConfigType = typeof integrationConfig
