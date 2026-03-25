// apps/web/src/app/(protected)/app/onboarding/organization/page.tsx
'use client'

import { CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@auxx/ui/components/form'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { Spinner } from '@auxx/ui/components/spinner'
import { toastError } from '@auxx/ui/components/toast'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Check, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useAnalytics } from '~/hooks/use-analytics'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
} from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { OnboardingNavigation } from '../_components/onboarding-navigation'
import { useOnboarding } from '../_components/onboarding-provider'

const formSchema = z.object({
  name: z.string().min(1, { error: 'Organization name is required' }),
  handle: z
    .string()
    .min(4, { error: 'Handle must be at least 4 characters' })
    .max(32, { error: 'Handle must be at most 32 characters' })
    .regex(/^[a-z0-9-]+$/, {
      error: 'Handle can only contain lowercase letters, numbers, and hyphens',
    }),
  website: z.url().optional().or(z.literal('')),
})

export default function OrganizationOnboardingPage() {
  const posthog = useAnalytics()
  const { state, updateOrganization, markStepCompleted, setCurrentStep } = useOnboarding()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null)
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(false)

  // Use dehydrated state instead of API call
  const organizationId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(organizationId)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    mode: 'onTouched',
    defaultValues: {
      name: state.organization.name || '',
      handle: state.organization.handle || org?.handle || '',
      website: state.organization.website || org?.website || '',
    },
  })

  // Auto-generate handle from name
  const generateHandle = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Watch name field to auto-generate handle
  const watchName = form.watch('name')
  const watchHandle = form.watch('handle')

  // Debounced handle for availability checking
  const [debouncedHandle, setDebouncedHandle] = useState('')

  // biome-ignore lint/correctness/useExhaustiveDependencies: generateHandle is a stable local function
  useEffect(() => {
    // Only auto-generate if user hasn't manually edited the handle
    if (watchName && !handleManuallyEdited && !org?.handle) {
      form.setValue('handle', generateHandle(watchName))
    }
  }, [watchName, handleManuallyEdited, form, org?.handle])

  // Debounce handle changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedHandle(watchHandle || '')
    }, 500)
    return () => clearTimeout(timer)
  }, [watchHandle])

  // Check handle availability query
  const { data: availabilityData, isLoading: isCheckingAvailability } =
    api.organization.checkHandleAvailability.useQuery(
      { handle: debouncedHandle },
      {
        enabled: debouncedHandle.length >= 4 && debouncedHandle !== org?.handle,
        refetchOnWindowFocus: false,
      }
    )

  // Update availability state based on query result
  useEffect(() => {
    if (!debouncedHandle || debouncedHandle.length < 4) {
      setHandleAvailable(null)
      return
    }

    // Skip if it's the current org's handle
    if (org?.handle === debouncedHandle) {
      setHandleAvailable(true)
      form.clearErrors('handle')
      return
    }

    if (availabilityData !== undefined) {
      const isAvailable = availabilityData.available || availabilityData.currentOrgId === org?.id
      setHandleAvailable(isAvailable)

      if (isAvailable) {
        form.clearErrors('handle')
      } else {
        form.setError('handle', { message: 'This handle is already taken' })
      }
    }
  }, [availabilityData, debouncedHandle, org?.handle, org?.id, form])

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)

    try {
      // Check if we already have the availability data and it's not available
      if (handleAvailable === false) {
        form.setError('handle', { message: 'This handle is already taken' })
        setIsSubmitting(false)
        return
      }

      // If handle is different from what we last checked, we need to verify
      if (values.handle !== debouncedHandle && values.handle !== org?.handle) {
        // For safety, we could refetch here, but since we're using real-time checking,
        // this scenario should be rare. The form validation should prevent submission
        // if the handle is invalid.
        toastError({
          title: 'Error',
          description: 'Please wait for handle availability check to complete.',
        })
        setIsSubmitting(false)
        return
      }

      // Save to context
      updateOrganization({
        name: values.name,
        handle: values.handle,
        website: values.website,
      })

      // Mark step as completed
      markStepCompleted(2)
      posthog?.capture('onboarding_step_completed', { step: 'organization' })

      // Navigate to next step
      setCurrentStep(3)
    } catch (error) {
      console.error('Failed to save organization information:', error)
      toastError({
        title: 'Error',
        description: 'Failed to save organization details. Please try again.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    setCurrentStep(1)
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
        ease: 'easeOut',
      },
    },
  }

  return (
    <div className='grid grid-cols-1 md:grid-cols-2 w-full'>
      {/* Left column: Organization form */}
      <div className='relative p-3 md:after:absolute md:after:right-0 md:after:top-[5px] md:after:bottom-[5px] md:after:w-px md:after:bg-white/10'>
        <motion.div variants={containerVariants} initial='hidden' animate='visible'>
          <motion.div variants={itemVariants}>
            <CardHeader>
              <CardTitle className=' font-normal'>Organization Details</CardTitle>
              <CardDescription>
                Tell us about your organization to personalize your workspace
              </CardDescription>
            </CardHeader>
          </motion.div>

          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-4'>
                {/* Organization Name */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name='name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization Name</FormLabel>
                        <FormControl>
                          <InputGroup variant='translucent'>
                            <InputGroupInput placeholder='Acme Corp' {...field} />
                            <InputGroupAddon align='inline-end'>
                              {form.formState.errors.name && (
                                <TooltipError text={form.formState.errors.name.message ?? ''} />
                              )}
                            </InputGroupAddon>
                          </InputGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Organization Handle */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name='handle'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization Handle</FormLabel>
                        <FormControl>
                          <InputGroup variant='translucent'>
                            <InputGroupAddon align='inline-start'>
                              <InputGroupText>auxx.ai /</InputGroupText>
                            </InputGroupAddon>
                            <InputGroupInput
                              placeholder='acme-corp'
                              {...field}
                              onFocus={() => {
                                // Mark as manually edited when user focuses the field
                                if (watchHandle) {
                                  setHandleManuallyEdited(true)
                                }
                              }}
                              onChange={(e) => {
                                // Mark as manually edited when user types
                                setHandleManuallyEdited(true)
                                field.onChange(e)
                              }}
                            />
                            <InputGroupAddon align='inline-end'>
                              {isCheckingAvailability ? (
                                <Spinner />
                              ) : handleAvailable === true ? (
                                <Check className='h-4 w-4 text-green-500' />
                              ) : handleAvailable === false ? (
                                <X className='h-4 w-4 text-destructive' />
                              ) : null}
                              {form.formState.errors.handle && (
                                <TooltipError text={form.formState.errors.handle.message ?? ''} />
                              )}
                            </InputGroupAddon>
                          </InputGroup>
                        </FormControl>
                        <FormDescription className='text-white/30'>
                          This will be used in your public URLs
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Website */}
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name='website'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website (optional)</FormLabel>
                        <FormControl>
                          <InputGroup variant='translucent'>
                            <InputGroupInput placeholder='https://example.com' {...field} />
                            <InputGroupAddon align='inline-end'>
                              {form.formState.errors.website && (
                                <TooltipError text={form.formState.errors.website.message ?? ''} />
                              )}
                            </InputGroupAddon>
                          </InputGroup>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </motion.div>

                {/* Navigation */}
                <motion.div variants={itemVariants}>
                  <OnboardingNavigation
                    onBack={handleBack}
                    onContinue={form.handleSubmit(onSubmit)}
                    continueDisabled={
                      !form.formState.isValid || isCheckingAvailability || handleAvailable === false
                    }
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
          className='absolute inset-0 h-full w-full opacity-40 object-cover mask-radial-from-10% mask-radial-to-100% mask-ellipse'
          src='/videos/signup-3.mp4'
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
            Build Your Workspace
          </motion.h2>
          <motion.p
            className='text-white/50'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}>
            Set up your organization to collaborate with your team and manage customer support
            efficiently.
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
