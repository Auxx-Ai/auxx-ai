// apps/web/src/app/(protected)/app/onboarding/personal/page.tsx
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
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AvatarUpload } from '~/components/file-upload/ui/avatar-upload'
import { useDehydratedUser } from '~/providers/dehydrated-state-provider'
import { OnboardingNavigation } from '../_components/onboarding-navigation'
import { useOnboarding } from '../_components/onboarding-provider'

const formSchema = z.object({
  firstName: z.string().min(1, { error: 'First name is required' }),
  lastName: z.string().min(1, { error: 'Last name is required' }),
})

export default function PersonalOnboardingPage() {
  const router = useRouter()
  const { state, updatePersonal, markStepCompleted, setCurrentStep } = useOnboarding()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get existing user data from dehydrated state
  const userData = useDehydratedUser()

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
      // Save to context
      updatePersonal({
        firstName: values.firstName,
        lastName: values.lastName,
      })

      // Mark step as completed
      markStepCompleted(1)

      // Navigate to next step
      setCurrentStep(2)
    } catch (error) {
      console.error('Failed to save personal information:', error)
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
        ease: 'easeOut',
      },
    },
  }

  return (
    <div className='grid grid-cols-1 md:grid-cols-2 w-full'>
      {/* Left column: Personal information form */}
      <div className='relative md:border-r p-3'>
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
                  <AvatarUpload currentAvatarUrl={userData.image} className='pb-6' />
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
                          <Input placeholder='John' {...field} />
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
                          <Input placeholder='Doe' {...field} />
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
                    continueDisabled={!form.formState.isValid}
                    continueLoading={isSubmitting}
                  />
                </motion.div>
              </form>
            </Form>
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
            Welcome to Auxx.ai! 🚀
          </motion.h2>
          <motion.p
            className='text-muted-foreground'
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}>
            Let's set up your account and get you started with AI-powered customer support.
          </motion.p>
        </motion.div>
      </div>
    </div>
  )
}
