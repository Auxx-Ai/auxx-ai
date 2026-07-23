// packages/lib/src/dehydration/types.ts

import type { PermissionKey } from '../permissions/capabilities/registry'

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
  /**
   * Slim alias-prefix → EntityDefinition UUID map for the ACTIVE org only.
   * Carries ONLY org-dynamic mappings: def-backed entityTypes (`contact`,
   * `work_order`, …), apiSlugs (system-typed + custom), and identity entries
   * for their def ids. Legacy system types (thread, message, …) resolve via
   * the static tier bundled with the client and are never included. Seeds
   * client-side RecordId normalization before `resource.list` hydrates the
   * resource store, so record fetching never waits on hydration on hard loads.
   */
  resourceIdMap?: Record<string, string>
}

/**
 * Environment configuration from NEXT_PUBLIC_* env vars and build info
 */
export interface DehydratedEnvironment {
  /** Deployment mode: 'cloud' (SaaS) or 'self-hosted' */
  deploymentMode: import('@auxx/deployment/client').DeploymentMode
  // Public URLs
  domain: string
  appUrl: string
  apiUrl: string
  homepageUrl: string
  docsUrl: string
  devPortalUrl: string
  kbUrl: string
  cdnUrl: string
  // Captcha
  turnstileSiteKey: string

  /** Shopify app slug — builds Admin deep-links (e.g. the app subscription page). */
  shopifyAppHandle: string

  // External services
  stripe: {
    publishableKey: string
  }
  pusher: {
    key: string
    cluster: string
    /** Self-hosted Sockudo host. Absent → hosted Pusher cloud (cluster). */
    wsHost?: string
    wsPort?: number
    forceTLS?: boolean
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

  /** Whether the demo system is enabled */
  demoEnabled: boolean

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
  // Session revocation metadata — lets the auth session callback validate the user
  // (existence, type, ban/force-change) from this cache instead of a per-request DB read.
  userType: 'USER' | 'SYSTEM' | 'AGENT'
  banned: boolean
  forcePasswordChange: boolean
  memberships: Array<{
    id: string
    userId: string
    organizationId: string
    role: string
    /** Seat packaging — 'full' | 'worker' (UI "Field seat"). */
    seatType: string
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
  domains: string[]
  handle: string | null
  about: string | null
  createdAt: string
  completedOnboarding: boolean
  demoExpiresAt: string | null

  // Subscription (nullable)
  subscription: {
    id: string
    status: string
    plan: string
    planId: string | null
    seats: number
    billingCycle: 'MONTHLY' | 'ANNUAL'

    // Billing provider routing (client-safe — no Stripe/Shopify secrets).
    // `null` = unlinked (admin detached the row from both providers); consumers fall back to 'stripe'.
    billingProvider: 'stripe' | 'shopify' | null
    shopifyShopDomain: string | null
    capabilities: import('@auxx/billing').BillingCapabilities

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

  /** The ACTIVE org's composed Layer-2 capability keys for THIS user (§7.1). */
  capabilities: PermissionKey[]

  /** Features that exceed the current plan's limits (empty if none) */
  overages: Array<{
    key: string
    label: string
    current: number
    limit: number
    excess: number
  }>

  // User settings for this org
  settings: Record<string, any>

  // Integration flags
  hasIntegrations: boolean
  hasOnlyForwardingChannel: boolean
}
