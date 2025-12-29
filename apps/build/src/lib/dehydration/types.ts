// apps/build/src/lib/dehydration/types.ts

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
  authenticatedUser: DehydratedBuildUser
  developerAccounts: DehydratedDeveloperAccount[]
  apps: DehydratedApp[]
  organizations: DehydratedOrganization[]
  invitedDeveloperAccounts: DehydratedDeveloperAccountInvitation[]
  environment: DehydratedBuildEnvironment
  timestamp: number
}

/**
 * Dehydrated user from User table
 */
export interface DehydratedBuildUser {
  id: string
  name: string | null
  email: string | null
  emailVerified: boolean
  image: string | null
  firstName: string | null
  lastName: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Dehydrated developer account with members
 */
export interface DehydratedDeveloperAccount {
  id: string
  title: string
  slug: string
  logoId: string | null
  logoUrl: string | null
  featureFlags: Record<string, boolean> | null
  createdAt: Date
  updatedAt: Date
  // This user's membership info in this account
  userMember: DehydratedUserMember
  // All members of this account
  members: DehydratedDeveloperAccountMember[]
}

/**
 * Current user's membership in an account
 */
export interface DehydratedUserMember {
  id: string
  userId: string
  accessLevel: 'admin' | 'member'
  createdAt: Date
}

/**
 * Dehydrated developer account member (for displaying team members)
 */
export interface DehydratedDeveloperAccountMember {
  id: string
  userId: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  accessLevel: 'admin' | 'member'
  createdAt: Date
}

/**
 * Dehydrated app - includes all app fields
 */
export interface DehydratedApp {
  // Basic info
  id: string
  developerAccountId: string
  slug: string
  title: string
  description: string | null

  // Avatar
  avatarId: string | null
  avatarUrl: string | null

  // Marketplace listing
  category: string | null
  websiteUrl: string | null
  documentationUrl: string | null
  contactUrl: string | null
  supportSiteUrl: string | null
  termsOfServiceUrl: string | null

  // Content
  overview: string | null
  contentOverview: string | null
  contentHowItWorks: string | null
  contentConfigure: string | null

  // Permissions
  scopes: string[] | null

  // OAuth
  hasOauth: boolean
  oauthExternalEntrypointUrl: string | null
  // oauthRedirectUris: string[] | null

  // Bundle
  hasBundle: boolean

  // Publication
  publicationStatus: string | null

  // Timestamps
  createdAt: Date
  updatedAt: Date
}

/**
 * Dehydrated organization (user organizations for filtering/selection)
 */
export interface DehydratedOrganization {
  id: string
  name: string | null
  handle: string
  slug: string
}

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
