// apps/web/src/components/mail/mail-status-config.ts

import { JobStatus, SendStatus, SYNC_STATUS } from '@auxx/database/enums'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  Pause,
  Phone,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { FacebookIcon, GoogleIcon, InstagramIcon, OutlookIcon } from '~/constants/icons'
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
    // RecordBadge-style classes (ring + bg + text) with dark-mode variants
    badgeClass:
      'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
    icon: Clock,
    label: 'Sending…',
    description: 'Message is being sent',
    animate: true,
  },
  [SendStatus.SENT]: {
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
    badgeClass:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
    icon: CheckCircle,
    label: 'Sent',
    description: 'Message sent successfully',
    animate: false,
  },
  [SendStatus.FAILED]: {
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
    badgeClass:
      'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
    icon: XCircle,
    label: 'Failed to send',
    description: 'Failed to send message',
    animate: false,
  },
  [SendStatus.BOUNCED]: {
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    borderColor: 'border-orange-200',
    badgeClass:
      'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900',
    icon: AlertTriangle,
    label: 'Bounced',
    description: 'The recipient’s mail server rejected this message',
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
// Custom Integration Status Configuration (for UI states)
// ============================================================================
export const integrationStatusConfig = {
  authenticated: {
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    borderColor: 'border-green-200',
    icon: CheckCircle,
    label: 'Connected',
    variant: 'green' as const,
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
    label: 'Quo',
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
  return <Icon className='h-3 w-3' />
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
export type IntegrationStatusConfigType = typeof integrationStatusConfig
export type IntegrationConfigType = typeof integrationConfig
