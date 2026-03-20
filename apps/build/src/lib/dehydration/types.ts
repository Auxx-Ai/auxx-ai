// apps/build/src/lib/dehydration/types.ts

import type {
  BuildCachedApp,
  BuildCachedDeveloperAccount,
  BuildCachedOrganization,
} from '@auxx/lib/cache'
import type { DehydratedUser } from '@auxx/lib/dehydration'

/**
 * Window global interface for build dehydrated state
 */
declare global {
  interface Window {
    AUXX_BUILD_DEHYDRATED_STATE?: BuildDehydratedState
  }
}

/**
 * Main dehydrated state for developer portal
 */
export interface BuildDehydratedState {
  authenticatedUser: DehydratedUser
  developerAccounts: BuildCachedDeveloperAccount[]
  apps: BuildCachedApp[]
  organizations: BuildCachedOrganization[]
  invitedDeveloperAccounts: DehydratedDeveloperAccountInvitation[]
  environment: DehydratedBuildEnvironment
  timestamp: number
}

/** @deprecated Use DehydratedUser from @auxx/lib/dehydration */
export type DehydratedBuildUser = DehydratedUser
/** Re-export from cache for backward compatibility */
export type DehydratedDeveloperAccount = BuildCachedDeveloperAccount
export type DehydratedApp = BuildCachedApp
export type DehydratedOrganization = BuildCachedOrganization

/** Current user's membership in an account */
export type DehydratedUserMember = BuildCachedDeveloperAccount['userMember']
/** Dehydrated developer account member (for displaying team members) */
export type DehydratedDeveloperAccountMember = BuildCachedDeveloperAccount['members'][number]

/**
 * Dehydrated developer account invitation
 */
export interface DehydratedDeveloperAccountInvitation {
  id: string
  developerAccountId: string
  developerAccountName: string
  invitedEmail: string
  accessLevel: 'admin' | 'member'
  status: 'pending' | 'accepted' | 'rejected'
  invitedBy: string
  invitedAt: Date
}

/**
 * Build environment configuration
 */
export interface DehydratedBuildEnvironment {
  devPortalUrl: string
  webappUrl: string
  nodeEnv: string
  isDevelopment: boolean
}
