// apps/web/src/providers/feature-flag-provider.tsx
'use client'

import type { FeatureKey, FeatureLimit } from '@auxx/lib/types'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useDehydratedOrganization, useDehydratedStateContext } from './dehydrated-state-provider'

// Type for the feature map object
type FeatureMapObject = Record<string, FeatureLimit | boolean> | null

// Define the shape of the context value
interface FeatureFlagContextType {
  features: FeatureMapObject
  isLoading: boolean
  error: unknown
  hasAccess: (key: FeatureKey | string) => boolean
  getLimit: (key: FeatureKey | string) => FeatureLimit | boolean | null
  /** True if currentCount >= the static limit for this key */
  isAtLimit: (key: FeatureKey | string, currentCount: number) => boolean
  /** True if currentCount >= the soft usage limit for this key */
  isAtSoftLimit: (key: FeatureKey | string, currentCount: number) => boolean
  /** True if currentCount >= the hard usage limit for this key */
  isAtHardLimit: (key: FeatureKey | string, currentCount: number) => boolean
}

/** Core limit check: is currentCount >= the numeric limit for this key? */
function checkLimit(
  features: FeatureMapObject,
  key: FeatureKey | string,
  currentCount: number
): boolean {
  if (!features) return true
  const limit = features[key]
  if (limit === '+') return false
  if (limit === true) return false
  if (typeof limit === 'number' && limit > 0) return currentCount >= limit
  return true
}

// Create the context with a default value
const FeatureFlagContext = createContext<FeatureFlagContextType | undefined>(undefined)

/**
 * Context for current organization ID
 */
const OrganizationIdContext = createContext<{
  organizationId: string | null
  setOrganizationId: (id: string | null) => void
} | null>(null)

/**
 * Provider for organization ID — derives from dehydrated state (single source of truth).
 * No prop needed; reads organizationId from DehydratedStateProvider.
 */
export function OrganizationIdProvider({ children }: { children: React.ReactNode }) {
  const { state, setOrganizationId: setDehydratedOrgId } = useDehydratedStateContext()
  const organizationId = state.organizationId

  const setOrganizationId = useCallback(
    (id: string | null) => {
      setDehydratedOrgId(id)
    },
    [setDehydratedOrgId]
  )

  return (
    <OrganizationIdContext.Provider value={{ organizationId, setOrganizationId }}>
      {children}
    </OrganizationIdContext.Provider>
  )
}

/**
 * Hook to access organization ID context
 */
export function useOrganizationIdContext() {
  const ctx = useContext(OrganizationIdContext)
  if (!ctx) {
    throw new Error('useOrganizationIdContext must be used within OrganizationIdProvider')
  }
  return ctx
}

/**
 * Provider component that provides feature flags from dehydrated state
 * No network requests - data is already available from server
 */
export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const { organizationId } = useOrganizationIdContext()
  const org = useDehydratedOrganization(organizationId)

  const features = org?.features ?? null
  const isLoading = false // No loading - data already available!
  const error = null

  // Memoized helper functions to avoid redefining on every render
  const hasAccess = useMemo(
    () =>
      (key: FeatureKey | string): boolean => {
        if (!features) return false
        const limit = features[key]
        if (limit === undefined || limit === false || limit === 0) {
          return false
        }
        return true // Access granted if true, '+', or a number > 0
      },
    [features]
  )

  const getLimit = useMemo(
    () =>
      (key: FeatureKey | string): FeatureLimit | boolean | null => {
        if (!features) return null
        return features[key] ?? null
      },
    [features]
  )

  const isAtLimit = useMemo(
    () => (key: FeatureKey | string, currentCount: number) =>
      checkLimit(features, key, currentCount),
    [features]
  )

  const isAtSoftLimit = useMemo(
    () => (key: FeatureKey | string, currentCount: number) =>
      checkLimit(features, key, currentCount),
    [features]
  )

  const isAtHardLimit = useMemo(
    () => (key: FeatureKey | string, currentCount: number) =>
      checkLimit(features, key, currentCount),
    [features]
  )

  const value = useMemo(
    () => ({
      features,
      isLoading,
      error,
      hasAccess,
      getLimit,
      isAtLimit,
      isAtSoftLimit,
      isAtHardLimit,
    }),
    [features, hasAccess, getLimit, isAtLimit, isAtSoftLimit, isAtHardLimit]
  )

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>
}

/**
 * Custom hook to easily consume feature flag context.
 */
export function useFeatureFlags() {
  const context = useContext(FeatureFlagContext)
  if (context === undefined) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagProvider')
  }
  return context
}
