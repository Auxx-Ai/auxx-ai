// apps/web/src/providers/feature-flag-provider.tsx
'use client'

import type { FeatureKey, FeatureLimit } from '@auxx/lib/types'
import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useDehydratedOrganization } from './dehydrated-state-provider'

// Type for the feature map object
type FeatureMapObject = Record<string, FeatureLimit | boolean> | null

// Define the shape of the context value
interface FeatureFlagContextType {
  features: FeatureMapObject
  isLoading: boolean
  error: unknown
  hasAccess: (key: FeatureKey | string) => boolean
  getLimit: (key: FeatureKey | string) => FeatureLimit | boolean | null
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
 * Provider for organization ID that FeatureFlagProvider can consume
 */
export function OrganizationIdProvider({
  children,
  initialOrganizationId,
}: {
  children: React.ReactNode
  initialOrganizationId?: string | null
}) {
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId ?? null)

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

  const value = useMemo(
    () => ({ features, isLoading, error, hasAccess, getLimit }),
    [features, isLoading, error, hasAccess, getLimit]
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
