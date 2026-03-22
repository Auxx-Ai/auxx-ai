// apps/web/src/app/(protected)/app/onboarding/connections/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, Mail } from 'lucide-react'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useChannels } from '~/components/channels/hooks/use-channels'
import { PROVIDER_ICONS } from '~/constants/icons'
import { useAnalytics } from '~/hooks/use-analytics'
import { api } from '~/trpc/react'
import { OnboardingNavigation } from '../_components/onboarding-navigation'
import { useOnboarding } from '../_components/onboarding-provider'

// Icons for providers
const GoogleIcon = () => (
  <svg className='size-5' viewBox='0 0 24 24'>
    <path
      fill='#4285F4'
      d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
    />
    <path
      fill='#34A853'
      d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
    />
    <path
      fill='#FBBC05'
      d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
    />
    <path
      fill='#EA4335'
      d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
    />
  </svg>
)

const OutlookIcon = PROVIDER_ICONS.outlook
// const MicrosoftIcon = () => (
//   <svg className="size-5" viewBox="0 0 23 23">
//     <path fill="#f25022" d="M0 0h11v11H0z" />
//     <path fill="#00a4ef" d="M12 0h11v11H12z" />
//     <path fill="#7fba00" d="M0 12h11v11H0z" />
//     <path fill="#ffb900" d="M12 12h11v11H12z" />
//   </svg>
// )

export default function ConnectionsOnboardingPage() {
  const router = useRouter()
  const posthog = useAnalytics()
  const { state, updateConnections, markStepCompleted, setCurrentStep } = useOnboarding()
  const [isConnecting, setIsConnecting] = useState<string | null>(null)

  const channels = useChannels()
  const getAuthUrl = api.channel.getAuthUrl.useMutation({
    onError: (error) => {
      toastError({
        title: 'Connection failed',
        description: error.message,
      })
    },
  })
  const integrations = channels

  // Optionally, update integrations if initialIntegrations changes
  // (e.g., if useIntegration fetches new data)
  // useEffect(() => {
  //   setIntegrations(initialIntegrations)
  // }, [initialIntegrations])

  // Check if already connected - only trust database, not local state
  // Local state can be falsely set if user navigates back from OAuth
  const isGoogleConnected = integrations?.some((i) => i.provider === 'google' && i.enabled) ?? false

  const isOutlookConnected =
    integrations?.some((i) => i.provider === 'outlook' && i.enabled) ?? false

  // Sync local state with actual integrations from database
  // This ensures state reflects reality after OAuth completion or browser back
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.connections and updateConnections are intentionally excluded to avoid loops
  useEffect(() => {
    if (integrations) {
      const actualGoogleStatus = integrations.some((i) => i.provider === 'google' && i.enabled)
      const actualOutlookStatus = integrations.some((i) => i.provider === 'outlook' && i.enabled)

      // Update local state to match database reality
      if (
        actualGoogleStatus !== state.connections.google ||
        actualOutlookStatus !== state.connections.outlook
      ) {
        updateConnections({
          google: actualGoogleStatus,
          outlook: actualOutlookStatus,
        })
      }
    }
  }, [integrations])

  const handleOAuthConnect = async (provider: 'google' | 'outlook') => {
    setIsConnecting(provider)

    try {
      await getAuthUrl.mutateAsync(
        {
          provider: provider as any,
          redirectPath: '/app/onboarding/connections',
        },
        {
          onSuccess: (data) => {
            if (data.authUrl) {
              // Don't update state here - only update after successful OAuth completion
              // This prevents false positives when user clicks back button
              window.location.href = data.authUrl
            }
          },
        }
      )
    } catch (error) {
      console.error('Failed to connect:', error)
      toastError({
        title: 'Connection failed',
        description: `Failed to connect to ${provider}. Please try again.`,
      })
      setIsConnecting(null)
    }
  }

  const handleSkip = () => {
    updateConnections({ skipped: true })
    markStepCompleted(3)
    posthog?.capture('onboarding_step_completed', { step: 'connections' })
    setCurrentStep(4)
  }

  const handleContinue = () => {
    markStepCompleted(3)
    posthog?.capture('onboarding_step_completed', { step: 'connections' })
    setCurrentStep(4)
  }

  const handleBack = () => {
    setCurrentStep(2)
  }

  const hasAnyConnection = isGoogleConnected || isOutlookConnected

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: 'easeOut' as const,
      },
    },
  }

  return (
    <div className='grid grid-cols-1 md:grid-cols-2 w-full'>
      {/* Left column: Connection options */}
      <div className='relative p-4 md:after:absolute md:after:right-0 md:after:top-[5px] md:after:bottom-[5px] md:after:w-px md:after:bg-white/10'>
        <motion.div variants={containerVariants} initial='hidden' animate='visible'>
          <motion.div variants={itemVariants}>
            <CardHeader>
              <CardTitle className='font-normal'>Connect your accounts</CardTitle>
              <CardDescription>
                By connecting your email and calendar, you'll be able to instantly see contacts from
                your entire network.
              </CardDescription>
            </CardHeader>
          </motion.div>

          <CardContent className='space-y-6'>
            {/* Google Connection */}
            <motion.div variants={itemVariants} className='space-y-4'>
              <Button
                type='button'
                variant={'translucent'}
                className='w-full justify-start gap-3 h-14'
                onClick={() => !isGoogleConnected && handleOAuthConnect('google')}
                disabled={isGoogleConnected || isConnecting !== null}
                loading={isConnecting === 'google'}
                loadingText='Connecting...'>
                <GoogleIcon />
                <span className='flex-1 text-left'>
                  {isGoogleConnected ? 'Google Connected' : 'Connect Google'}
                </span>
                {isGoogleConnected && (
                  <span className='flex size-6 items-center justify-center rounded-full border border-green-500 bg-transparent'>
                    <Check className='size-3.5 text-green-500' />
                  </span>
                )}
              </Button>

              {/* Microsoft Connection */}
              <Button
                type='button'
                variant={'translucent'}
                className={cn(
                  'w-full justify-start gap-3 h-14',
                  isOutlookConnected && 'opacity-70'
                )}
                onClick={() => !isOutlookConnected && handleOAuthConnect('outlook')}
                disabled={isOutlookConnected || isConnecting !== null}
                loading={isConnecting === 'outlook'}
                loadingText='Connecting...'>
                <OutlookIcon />
                <span className='flex-1 text-left'>
                  {isOutlookConnected ? 'Outlook Connected' : 'Connect Outlook'}
                </span>
                {isOutlookConnected && (
                  <span className='flex size-5 items-center justify-center rounded-full border border-green-500 bg-transparent'>
                    <Check className='size-3.5 text-green-500' />
                  </span>
                )}
              </Button>
            </motion.div>

            {/* Info message */}
            <motion.div variants={itemVariants} className='rounded-lg bg-muted/10 p-4'>
              <p className='text-sm text-white/70'>
                <Mail className='inline size-4 mr-2' />
                Your email data is securely encrypted and only used to provide AI-powered support
                responses.
              </p>
            </motion.div>

            {/* Navigation */}
            <motion.div variants={itemVariants}>
              <OnboardingNavigation
                onBack={handleBack}
                onContinue={hasAnyConnection ? handleContinue : undefined}
                onSkip={!hasAnyConnection ? handleSkip : undefined}
                showContinue={hasAnyConnection}
                showSkip={!hasAnyConnection}
                continueText={hasAnyConnection ? 'Continue' : 'Skip for now'}
              />
            </motion.div>
          </CardContent>
        </motion.div>
      </div>

      {/* Right column: Illustration - hidden on mobile */}
      <div className='hidden md:flex items-center justify-center p-14'>
        <motion.div
          className='text-center'
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}>
          <motion.h2
            className='text-2xl font-semibold mb-4'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}>
            Sync Your Data
          </motion.h2>
          <motion.p
            className='text-white/50'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}>
            Connect your email accounts to automatically import customer conversations and provide
            better support with AI.
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
