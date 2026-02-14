// apps/web/src/app/(protected)/app/onboarding/_components/onboarding-provider.tsx
'use client'
import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

/**
 * Team invite interface
 */
interface TeamInvite {
  email: string
  role: OrganizationRole
}
/**
 * Onboarding state interface
 */
interface OnboardingState {
  currentStep: 1 | 2 | 3 | 4
  completedSteps: number[]
  personal: {
    firstName: string
    lastName: string
  }
  organization: {
    name: string
    handle: string
    website?: string
  }
  connections: {
    google?: boolean
    outlook?: boolean
    skipped?: boolean
  }
  team: {
    invites: TeamInvite[]
    skipped?: boolean
  }
}
/**
 * Onboarding context interface
 */
interface OnboardingContextValue {
  state: OnboardingState
  updatePersonal: (data: Partial<OnboardingState['personal']>) => void
  updateOrganization: (data: Partial<OnboardingState['organization']>) => void
  updateConnections: (data: Partial<OnboardingState['connections']>) => void
  updateTeam: (data: Partial<OnboardingState['team']>) => void
  markStepCompleted: (step: number) => void
  setCurrentStep: (step: 1 | 2 | 3 | 4) => void
  resetState: () => void
  canNavigateToStep: (step: number) => boolean
}
/**
 * Default onboarding state
 */
const defaultState: OnboardingState = {
  currentStep: 1,
  completedSteps: [],
  personal: {
    firstName: '',
    lastName: '',
  },
  organization: {
    name: '',
    handle: '',
    website: '',
  },
  connections: {
    google: false,
    outlook: false,
    skipped: false,
  },
  team: {
    invites: [{ email: '', role: OrganizationRoleEnum.USER }],
    skipped: false,
  },
}
const STORAGE_KEY = 'onboarding-state'
/**
 * Onboarding context
 */
const OnboardingContext = createContext<OnboardingContextValue | null>(null)
/**
 * Onboarding provider props
 */
interface OnboardingProviderProps {
  children: ReactNode
  /** Optional starting step (1-4) to skip completed steps */
  startStep?: 1 | 2 | 3 | 4
}
/**
 * Maps route paths to step numbers
 */
const pathToStep: Record<string, 1 | 2 | 3 | 4> = {
  '/app/onboarding/personal': 1,
  '/app/onboarding/organization': 2,
  '/app/onboarding/connections': 3,
  '/app/onboarding/team': 4,
}
/**
 * Maps step numbers to route paths
 */
const stepToPath: Record<number, string> = {
  1: '/app/onboarding/personal',
  2: '/app/onboarding/organization',
  3: '/app/onboarding/connections',
  4: '/app/onboarding/team',
}
/**
 * Onboarding provider component
 */
export function OnboardingProvider({ children, startStep = 1 }: OnboardingProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState<OnboardingState>(() => ({
    ...defaultState,
    currentStep: startStep,
    // Mark previous steps as completed when starting from a later step
    completedSteps: Array.from({ length: startStep - 1 }, (_, i) => i + 1),
  }))
  // Load state from sessionStorage on mount
  useEffect(() => {
    const savedState = sessionStorage.getItem(STORAGE_KEY)
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState)
        // Only use saved state if it's from the same or later step
        if (parsed.currentStep >= startStep) {
          setState(parsed)
        }
      } catch (error) {
        console.error('Failed to parse saved onboarding state:', error)
      }
    }
  }, [startStep])
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
  /**
   * Update personal information
   */
  const updatePersonal = (data: Partial<OnboardingState['personal']>) => {
    setState((prev) => ({
      ...prev,
      personal: { ...prev.personal, ...data },
    }))
  }
  /**
   * Update organization information
   */
  const updateOrganization = (data: Partial<OnboardingState['organization']>) => {
    setState((prev) => ({
      ...prev,
      organization: { ...prev.organization, ...data },
    }))
  }
  /**
   * Update connections information
   */
  const updateConnections = (data: Partial<OnboardingState['connections']>) => {
    setState((prev) => ({
      ...prev,
      connections: { ...prev.connections, ...data },
    }))
  }
  /**
   * Update team information
   */
  const updateTeam = (data: Partial<OnboardingState['team']>) => {
    setState((prev) => ({
      ...prev,
      team: { ...prev.team, ...data },
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
  const setCurrentStep = (step: 1 | 2 | 3 | 4) => {
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
  const value: OnboardingContextValue = {
    state,
    updatePersonal,
    updateOrganization,
    updateConnections,
    updateTeam,
    markStepCompleted,
    setCurrentStep,
    resetState,
    canNavigateToStep,
  }
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}
/**
 * Hook to use onboarding context
 */
export function useOnboarding() {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider')
  }
  return context
}
