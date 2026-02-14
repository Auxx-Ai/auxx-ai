// hooks/use-user.ts

import type { OrganizationRole } from '@auxx/database/types'
import type { Settings } from '@auxx/lib/settings/types'
import type { FeatureMapObject } from '@auxx/lib/types'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'
import { client as authClient } from '~/auth/auth-client'
import { clearResourceCaches } from '~/components/resources'
import {
  useDehydratedOrganization,
  useDehydratedOrganizations,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

export interface OrganizationMember {
  id: string
  organizationId: string
  userId: string
  role: OrganizationRole
  organization: {
    id: string
    name: string | null
    website: string | null
    email_domain: string | null
  }
}
export interface UserData {
  id: string
  name: string | null
  email: string | null
  emailVerified: boolean
  image: string | null
  defaultOrganizationId: string | null
  providers: string[]
  hasPassword: boolean
  registrationMethod: 'oauth' | 'email' | 'phone' | 'mixed'
  memberships: OrganizationMember[]
}

interface UseUserOptions {
  /** If true, redirects to onboarding if user hasn't completed onboarding */
  requireOnboarding?: boolean
  /** If set, requires user to have a membership in an organization */
  requireOrganization?: boolean
  /** If set, requires user to have one of these roles in their current organization */
  requireRoles?: OrganizationRole[]
}

interface UseUserResult {
  /** Current user data */
  user: UserData | null
  /** Currently active organization */
  organization: OrganizationMember['organization'] | null
  /** User's role in the current organization */
  role: OrganizationRole | null
  /** User's ID */
  userId: string | null
  /** Currently active organization's ID */
  organizationId: string | null
  /** Whether data is still loading */
  isLoading: boolean
  /** Function to switch active organization */
  switchOrganization: (organizationId: string) => void
  /** Whether user is an admin or owner in the current organization */
  isAdminOrOwner: boolean
  /** Whether user is an owner in the current organization */
  isOwner: boolean
  features: FeatureMapObject | null
  hasIntegrations: boolean | null
  settings: Settings | null
}
/**
 * Hook to get the current user data, organization, and role
 * Uses dehydrated state - no API calls or loading!
 * Note: Layout already enforces authentication, but this hook handles role-based access control
 */
export function useUser(options: UseUserOptions = {}): UseUserResult {
  const { requireOnboarding = false, requireOrganization = false, requireRoles = [] } = options
  const router = useRouter()
  const pathname = usePathname()

  // Get user from dehydrated state
  const dehydratedUser = useDehydratedUser()

  // Use organization ID context to share state with FeatureFlagProvider
  const { organizationId, setOrganizationId } = useOrganizationIdContext()

  const switchOrganizationMutation = api.organization.setDefault.useMutation()

  // Effect to set the current organization ID based on user data
  useEffect(() => {
    if (dehydratedUser && !organizationId) {
      // If user has a default organization, use that
      if (
        dehydratedUser.defaultOrganizationId &&
        dehydratedUser.memberships.some(
          (m) => m.organizationId === dehydratedUser.defaultOrganizationId
        )
      ) {
        setOrganizationId(dehydratedUser.defaultOrganizationId)
      }
      // Otherwise use the first organization they're a member of
      else if (dehydratedUser.memberships.length > 0) {
        setOrganizationId(dehydratedUser.memberships[0].organizationId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dehydratedUser, organizationId])

  // Get organization details from dehydrated state
  const org = useDehydratedOrganization(organizationId)

  // Get the current membership and role
  const currentMembership = dehydratedUser.memberships.find(
    (m) => m.organizationId === organizationId
  )
  const role = currentMembership?.role || null
  const isAdminOrOwner = role === 'ADMIN' || role === 'OWNER'
  const isOwner = role === 'OWNER'

  // Build organization object for backward compatibility
  const organization = org
    ? {
        id: org.id,
        name: org.name,
        website: org.website,
        email_domain: org.emailDomain,
      }
    : null

  // Effect to handle role-based access control requirements
  useEffect(() => {
    // Skip for auth pages
    if (pathname === '/login' || pathname === '/register' || pathname === '/forgot-password') return

    // Redirect to onboarding if required but not completed
    if (requireOnboarding && !dehydratedUser.completedOnboarding) {
      router.push('/app/onboarding')
      return
    }

    // Redirect to create organization page if an organization is required but user has none
    if (requireOrganization && dehydratedUser.memberships.length === 0) {
      // router.push('/create-organization')
      return
    }

    // Redirect to access denied page if specific roles are required but user doesn't have any of them
    if (requireRoles.length > 0 && role && !requireRoles.includes(role)) {
      router.push('/access-denied')
      return
    }
  }, [pathname, requireOnboarding, requireOrganization, requireRoles, dehydratedUser, router, role])

  // Function to switch the active organization
  const switchOrganization = (newOrganizationId: string) => {
    // Validate that the user is a member of this organization
    if (dehydratedUser.memberships.some((m) => m.organizationId === newOrganizationId)) {
      setOrganizationId(newOrganizationId)
      // Update the default organization in the database
      switchOrganizationMutation.mutate(
        { organizationId: newOrganizationId },
        {
          onSuccess: async () => {
            // Clear client-side caches before reload to prevent stale data
            clearResourceCaches()
            // Force session cache refresh to get updated defaultOrganizationId
            await authClient.getSession({ query: { disableCookieCache: true } })
            // Full page reload to get fresh dehydrated state from server
            window.location.reload()
          },
        }
      )
    }
  }

  // Get all organizations from dehydrated state
  const dehydratedOrganizations = useDehydratedOrganizations()

  // Build user data object for backward compatibility (memoized to prevent infinite re-renders)
  const userData: UserData = useMemo(
    () => ({
      id: dehydratedUser.id,
      name: dehydratedUser.name,
      email: dehydratedUser.email,
      emailVerified: dehydratedUser.emailVerified,
      image: dehydratedUser.image,
      defaultOrganizationId: dehydratedUser.defaultOrganizationId,
      providers: dehydratedUser.providers,
      hasPassword: dehydratedUser.hasPassword,
      registrationMethod: dehydratedUser.registrationMethod,
      memberships: dehydratedUser.memberships.map((m) => {
        // Look up organization data from dehydrated organizations
        const orgData = dehydratedOrganizations.find((o) => o.id === m.organizationId)
        return {
          id: m.id,
          userId: m.userId,
          organizationId: m.organizationId,
          role: m.role as OrganizationRole,
          organization: {
            id: m.organizationId,
            name: orgData?.name ?? null,
            website: orgData?.website ?? null,
            email_domain: orgData?.emailDomain ?? null,
          },
        }
      }),
    }),
    [dehydratedUser, dehydratedOrganizations]
  )

  return {
    user: userData,
    organization,
    role,
    userId: dehydratedUser.id,
    organizationId,
    isLoading: false, // No loading - data already available!
    switchOrganization,
    isAdminOrOwner,
    isOwner,
    settings: org?.settings || null,
    features: org?.features || null,
    hasIntegrations: org?.hasIntegrations ?? null,
  }
}
