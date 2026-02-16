// src/app/(auth)/forgot-password/_components/forgot-password-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast' // Use your toast system
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { client } from '~/auth/auth-client'
import { useAnalytics } from '~/hooks/use-analytics'

// Schema for validation
const formSchema = z.object({
  email: z.email({ error: 'Please enter a valid email address.' }),
})

type ForgotPasswordFormValues = z.infer<typeof formSchema>

export function ForgotPasswordForm() {
  const posthog = useAnalytics()
  const [isLoading, setIsLoading] = useState(false)
  const form = useForm<ForgotPasswordFormValues>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotPasswordFormValues) {
    setIsLoading(true)
    const { data, error } = await client.forgetPassword({
      email: values.email,
      redirectTo: '/reset-password',
    })
    if (error) {
      toastError({ title: 'Request Failed', description: error.message })
    }
    if (data) {
      posthog?.capture('password_reset_requested')
      toastSuccess({
        title: 'Request Sent',
        description: 'If an account exists for this email, a password reset link has been sent.',
      })
      form.reset()
    }
    setIsLoading(false)
  }

  return (
    <Card className='w-full max-w-md shadow-md shadow-black/20 border-transparent'>
      <CardHeader className='text-center'>
        <CardTitle>Forgot Your Password?</CardTitle>
        <CardDescription>
          Enter your email address below, and we&apos;ll send you a link to reset your password if
          an account exists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      placeholder='your@email.com'
                      {...field}
                      disabled={isLoading} // Disable input while loading
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type='submit' className='w-full' loading={isLoading} loadingText='Sending...'>
              Send Reset Link
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className='flex justify-center'>
        <Button variant='link' asChild className='text-sm'>
          <Link href='/login'>Back to Login</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
