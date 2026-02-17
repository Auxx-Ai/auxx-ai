// packages/lib/src/dehydration/types.ts

/**
 * Window global interface for dehydrated state
 */
declare global {
  interface Window {
    AUXX_DEHYDRATED_STATE?: DehydratedState
  }
}

/**
 * Main dehydrated state interface injected server-side
 */
export interface DehydratedState {
  user?: DehydratedUser
  organizationId: string | null
  organizations: DehydratedOrganization[]
  settingsCatalog: Record<string, any>
  environment: DehydratedEnvironment
  timestamp: number
}

/**
 * Environment configuration from NEXT_PUBLIC_* env vars and build info
 */
export interface DehydratedEnvironment {
  /** Deployment mode: 'cloud' (SaaS) or 'self-hosted' */
  deploymentMode: import('@auxx/deployment/client').DeploymentMode
  // Public URLs
  appUrl: string
  apiUrl: string
  homepageUrl: string
  docsUrl: string
  devPortalUrl: string
  cdnUrl: string
  // External services
  stripe: {
    publishableKey: string
  }
  pusher: {
    key: string
    cluster: string
  }
  posthog: {
    key: string
    host: string
  }
  storage: {
    type: 's3' | 'local'
    bucket: string | null
    region: string | null
  }

  // Build/version info
  version: {
    appVersion: string
    commit: string
    buildTime: string
    nodeEnv: string
  }
}

/**
 * Dehydrated user data with memberships
 */
export interface DehydratedUser {
  id: string
  name: string | null
  email: string | null
  emailVerified: boolean
  image: string | null
  firstName: string | null
  lastName: string | null
  phoneNumber: string | null
  phoneNumberVerified: boolean | null
  completedOnboarding: boolean | null
  defaultOrganizationId: string | null
  lastLoginAt: Date | null
  preferredTimezone: string | null
  // Auth metadata
  providers: string[]
  hasPassword: boolean
  isSuperAdmin: boolean
  registrationMethod: 'oauth' | 'email' | 'phone' | 'mixed'
  memberships: Array<{
    id: string
    userId: string
    organizationId: string
    role: string
    status: string
  }>
}

/**
 * Dehydrated organization data with subscription, features, and settings
 */
export interface DehydratedOrganization {
  // Organization basics
  id: string
  name: string | null
  website: string | null
  emailDomain: string | null
  handle: string | null
  about: string | null
  createdAt: string
  completedOnboarding: boolean

  // Subscription (nullable)
  subscription: {
    id: string
    status: string
    plan: string
    planId: string | null
    seats: number
    billingCycle: 'MONTHLY' | 'ANNUAL'
    periodStart: string | null
    periodEnd: string | null
    cancelAtPeriodEnd: boolean
    canceledAt: string | null
    trialStart: string | null
    trialEnd: string | null
    hasTrialEnded: boolean
    isEligibleForTrial: boolean

    // Scheduled changes
    scheduledPlanId: string | null
    scheduledPlan: string | null
    scheduledBillingCycle: 'MONTHLY' | 'ANNUAL' | null
    scheduledSeats: number | null
    scheduledChangeAt: string | null
  } | null

  // Feature permissions
  features: Record<string, boolean | number | '+'>

  // User settings for this org
  settings: Record<string, any>

  // Integration flags
  hasIntegrations: boolean
}
