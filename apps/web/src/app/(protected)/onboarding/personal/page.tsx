// apps/web/src/app/(protected)/onboarding/personal/page.tsx
'use client'

import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AvatarUpload } from '~/components/file-upload/ui/avatar-upload'
import { useAnalytics } from '~/hooks/use-analytics'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { OnboardingNavigation } from '../_components/onboarding-navigation'
import { useOnboarding } from '../_components/onboarding-provider'

const formSchema = z.object({
  firstName: z.string().min(1, { error: 'First name is required' }),
  lastName: z.string().min(1, { error: 'Last name is required' }),
})

export default function PersonalOnboardingPage() {
  const posthog = useAnalytics()
  const { state, updatePersonal, markStepCompleted, setCurrentStep } = useOnboarding()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get existing user data from dehydrated state
  const userData = useDehydratedUser()!

  // An invited member joins an org that is already onboarded, so this screen is the
  // whole of their onboarding — there is no step 2 to send them to.
  const organizationId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(organizationId)
  const isSoloStep = org?.completedOnboarding ?? false

  const updateUserProfile = api.user.updateProfile.useMutation()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      firstName: state.personal.firstName || userData?.firstName || '',
      lastName: state.personal.lastName || userData?.lastName || '',
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)

    try {
      // Persist here rather than deferring to the wizard's final step: this step is
      // a gate of its own now, and a member who only ever sees this screen would
      // otherwise save nothing. Also stops a founder who abandons the wizard at
      // step 2 from losing their name.
      //
      // `completedOnboarding` rides along on THIS mutation on purpose — it is the
      // only write that fires `onCacheEvent('user.updated')`, which the `/app` gate
      // depends on. See routers/user.ts.
      await updateUserProfile.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        completedOnboarding: true,
      })

      // Save to context
      updatePersonal({
        firstName: values.firstName,
        lastName: values.lastName,
      })

      // Mark step as completed
      markStepCompleted(1)
      posthog?.capture('onboarding_step_completed', { step: 'personal' })

      if (isSoloStep) {
        posthog?.capture('onboarding_completed')
        // Redirect through /onboarding rather than to /app directly, so the entry
        // point stays the single place that decides where a finished user lands
        // (it also owns the Shopify-claim branch). Full reload to rebuild the
        // dehydrated state the /app gate reads.
        window.location.href = '/onboarding'
        return
      }

      // Navigate to next step
      setCurrentStep(2)
    } catch (error) {
      console.error('Failed to save personal information:', error)
      toastError({
        title: 'Error saving your details',
        description: error instanceof Error ? error.message : 'Please try again.',
      })
      setIsSubmitting(false)
    }
  }

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
      {/* Left column: Personal information form */}
      <div className='relative p-3 md:after:absolute md:after:right-0 md:after:top-[5px] md:after:bottom-[5px] md:after:w-px md:after:bg-white/10'>
        <motion.div variants={containerVariants} initial='hidden' animate='visible'>
          <motion.div variants={itemVariants}>
            <CardHeader>
              <CardTitle className=' font-normal'>Let's get to know you</CardTitle>
              <CardDescription>
                Tell us a bit about yourself to personalize your experience
              </CardDescription>
            </CardHeader>
          </motion.div>

          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
                {/* Avatar Upload */}
                <motion.div variants={itemVariants} className='flex justify-center'>
                  <AvatarUpload
                    variant='translucent'
                    currentAvatarUrl={userData.image ?? undefined}
                    className='pb-6'
                  />
                </motion.div>

                {/* First Name */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name='firstName'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input variant='translucent' size='lg' placeholder='John' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Last Name */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name='lastName'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input variant='translucent' size='lg' placeholder='Doe' {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Navigation */}
                <motion.div variants={itemVariants}>
                  <OnboardingNavigation
                    showBack={false}
                    onContinue={form.handleSubmit(onSubmit)}
                    continueText={isSoloStep ? 'Get started' : 'Continue'}
                    continueDisabled={!form.formState.isValid}
                    continueLoading={isSubmitting}
                  />
                </motion.div>
              </form>
            </Form>
          </CardContent>
        </motion.div>
      </div>

      {/* Right column: Video - hidden on mobile */}
      <div className='hidden md:flex relative overflow-hidden items-center justify-center'>
        <video
          autoPlay
          loop
          muted
          playsInline
          className='absolute inset-0 h-full w-full opacity-40 backdrop-blur-sm object-cover mask-radial-from-10% mask-radial-to-100% mask-ellipse'
          src='/videos/signup-2.mp4'
        />
        <motion.div
          className='relative z-10 text-center p-14'
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}>
          <motion.h2
            className='text-2xl font-semibold mb-4'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}>
            {isSoloStep && org?.name ? `Welcome to ${org.name}` : 'Welcome to Auxx.ai'}
          </motion.h2>
          <motion.p
            className='text-white/50'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}>
            {isSoloStep
              ? 'Your team is already set up — just tell us who you are and you’re in.'
              : "Let's set up your account and get you started with AI-powered customer support."}
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
