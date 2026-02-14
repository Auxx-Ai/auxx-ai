// apps/web/src/app/(protected)/subscription/convert/_components/convert-provider.tsx
'use client'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { Plan } from '~/components/subscriptions/plan-comparison'
import { useDehydratedOrganization } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * Subscription convert state interface
 */
interface ConvertState {
  currentStep: 1 | 2 | 3 // explore -> addons -> summary
  completedSteps: number[]
  selectedPlan: Plan | null
  addons: {
    seats: number
  }
  billingCycle: 'MONTHLY' | 'ANNUAL'
}

/**
 * Subscription convert context interface
 */
interface ConvertContextValue {
  state: ConvertState
  isLoading: boolean
  updateSelectedPlan: (plan: Plan) => void
  updateAddons: (data: Partial<ConvertState['addons']>) => void
  updateBillingCycle: (cycle: 'MONTHLY' | 'ANNUAL') => void
  markStepCompleted: (step: number) => void
  setCurrentStep: (step: 1 | 2 | 3) => void
  resetState: () => void
  canNavigateToStep: (step: number) => boolean
}

/**
 * Default convert state
 */
const defaultState: ConvertState = {
  currentStep: 1,
  completedSteps: [],
  selectedPlan: null,
  addons: {
    seats: 1,
  },
  billingCycle: 'MONTHLY',
}

const STORAGE_KEY = 'subscription-convert-state'

/**
 * Convert context
 */
const ConvertContext = createContext<ConvertContextValue | null>(null)

/**
 * Convert provider props
 */
interface ConvertProviderProps {
  children: ReactNode
}

/**
 * Maps route paths to step numbers
 */
const pathToStep: Record<string, 1 | 2 | 3> = {
  '/subscription/convert/explore': 1,
  '/subscription/convert/addons': 2,
  '/subscription/convert/summary': 3,
}

/**
 * Maps step numbers to route paths
 */
const stepToPath: Record<number, string> = {
  1: '/subscription/convert/explore',
  2: '/subscription/convert/addons',
  3: '/subscription/convert/summary',
}

/**
 * Convert provider component
 */
export function ConvertProvider({ children }: ConvertProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState<ConvertState>(defaultState)
  const [hydrated, setHydrated] = useState(false)

  const { organizationId } = useOrganizationIdContext()
  const organization = useDehydratedOrganization(organizationId)
  const { data: plans, isLoading: plansLoading } = api.billing.getPlans.useQuery()

  // Load from sessionStorage after hydration
  useEffect(() => {
    const savedState = sessionStorage.getItem(STORAGE_KEY)
    if (savedState) {
      try {
        setState(JSON.parse(savedState))
      } catch (error) {
        console.error('Failed to parse saved convert state:', error)
      }
    }
    setHydrated(true)
  }, [])

  // Initialize from dehydrated subscription when plans load and we don't have a selected plan
  useEffect(() => {
    // Wait for hydration and plans to load
    if (!hydrated || state.selectedPlan || !plans || plansLoading) return

    let planToSelect = null
    let billingCycle: 'MONTHLY' | 'ANNUAL' = 'MONTHLY'
    let seats = 1

    // If they have a subscription (even expired), use those details
    if (organization?.subscription) {
      planToSelect = plans.find((p) => p.id === organization.subscription?.planId) || null
      billingCycle = organization.subscription?.billingCycle || 'MONTHLY'
      seats = organization.subscription?.seats || 1
    }

    // If no subscription plan found, and on /addons route, default to Pro
    if (!planToSelect && pathname === '/subscription/convert/addons') {
      planToSelect = plans.find((p) => p.name === 'Pro') || null
    }

    if (planToSelect) {
      console.log('Initializing convert state:', {
        plan: planToSelect.name,
        cycle: billingCycle,
        seats: seats,
      })
      setState((prev) => ({
        ...prev,
        selectedPlan: planToSelect,
        billingCycle: billingCycle,
        addons: {
          seats: seats,
        },
      }))
    }
  }, [hydrated, organization, plans, plansLoading, state.selectedPlan, pathname])

  // Save state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // Update current step based on pathname
  useEffect(() => {
    const step = pathToStep[pathname]
    if (step && step !== state.currentStep) {
      setState((prev) => ({ ...prev, currentStep: step }))
    }
  }, [pathname, state.currentStep])

  // Check for reactivation flow
  useEffect(() => {
    if (!hydrated) return

    const reactivationOrgId = sessionStorage.getItem('reactivation-organization-id')
    if (reactivationOrgId && pathname.includes('/subscription/convert')) {
      // Mark as reactivation flow
      console.log('Detected reactivation flow for org:', reactivationOrgId)

      // The standard convert flow will work with pre-filled state from sessionStorage
      // Could add reactivation-specific messaging or tracking here if needed
    }
  }, [hydrated, pathname])

  /**
   * Update selected plan
   */
  const updateSelectedPlan = (plan: Plan) => {
    setState((prev) => ({
      ...prev,
      selectedPlan: plan,
    }))
  }

  /**
   * Update addons information
   */
  const updateAddons = (data: Partial<ConvertState['addons']>) => {
    setState((prev) => ({
      ...prev,
      addons: { ...prev.addons, ...data },
    }))
  }

  /**
   * Update billing cycle
   */
  const updateBillingCycle = (cycle: 'MONTHLY' | 'ANNUAL') => {
    setState((prev) => ({
      ...prev,
      billingCycle: cycle,
    }))
  }

  /**
   * Mark a step as completed
   */
  const markStepCompleted = (step: number) => {
    setState((prev) => ({
      ...prev,
      completedSteps: prev.completedSteps.includes(step)
        ? prev.completedSteps
        : [...prev.completedSteps, step],
    }))
  }

  /**
   * Set current step and navigate
   */
  const setCurrentStep = (step: 1 | 2 | 3) => {
    setState((prev) => ({ ...prev, currentStep: step }))
    router.push(stepToPath[step])
  }

  /**
   * Check if user can navigate to a specific step
   */
  const canNavigateToStep = (step: number): boolean => {
    // Can always go to step 1
    if (step === 1) return true
    // Can only go to a step if previous step is completed
    return state.completedSteps.includes(step - 1)
  }

  /**
   * Reset state to default
   */
  const resetState = () => {
    setState(defaultState)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  const value: ConvertContextValue = {
    state,
    isLoading: plansLoading,
    updateSelectedPlan,
    updateAddons,
    updateBillingCycle,
    markStepCompleted,
    setCurrentStep,
    resetState,
    canNavigateToStep,
  }

  return <ConvertContext.Provider value={value}>{children}</ConvertContext.Provider>
}

/**
 * Hook to use convert context
 */
export function useConvert() {
  const context = useContext(ConvertContext)
  if (!context) {
    throw new Error('useConvert must be used within ConvertProvider')
  }
  return context
}
