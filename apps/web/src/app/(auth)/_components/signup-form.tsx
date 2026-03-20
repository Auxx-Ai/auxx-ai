// src/app/(auth)/_components/signup-form.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Card, CardContent } from '@auxx/ui/components/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { Input } from '@auxx/ui/components/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@auxx/ui/components/input-otp'
import PhoneInputWithFlag from '@auxx/ui/components/phone-input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Turnstile } from '@marsidev/react-turnstile'
import { Mail, Smartphone } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { client } from '~/auth/auth-client'
import { PasswordField } from '~/components/credentials/password-fields'
import { GithubIcon, GoogleIcon } from '~/constants/icons'
import { useAnalytics } from '~/hooks/use-analytics'
import { useTurnstile } from '~/hooks/use-turnstile'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { GeneralSubmitButton } from './submit-button'

// Schema for email-based signup validation
const emailFormSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
})

// Regex used to validate international phone numbers
const phoneNumberRegex = /^\+?\d{7,15}$/

// Schema for phone-based signup validation
const phoneFormSchema = z.object({
  phone: z.string().min(1, { message: 'Phone number is required.' }).regex(phoneNumberRegex, {
    message: 'Please enter a valid phone number (e.g. +1234567890).',
  }),
})

// Type representing email signup form values
type EmailSignUpFormValues = z.infer<typeof emailFormSchema>

// Type representing phone signup form values
type PhoneSignUpFormValues = z.infer<typeof phoneFormSchema>

/**
 * Form component for user registration.
 * Handles form validation, API calls for registration, and automatic login on success.
 */
export function SignUpForm() {
  const router = useRouter()
  const posthog = useAnalytics()
  const { turnstileSiteKey } = useEnv()
  const {
    token: turnstileToken,
    onSuccess: onTurnstileSuccess,
    onExpire: onTurnstileExpire,
    onError: onTurnstileError,
    reset: resetTurnstile,
    widgetRef: turnstileRef,
  } = useTurnstile()
  const emailForm = useForm<EmailSignUpFormValues>({
    resolver: standardSchemaResolver(emailFormSchema),
    defaultValues: { email: '', password: '' },
  })
  const phoneForm = useForm<PhoneSignUpFormValues>({
    resolver: standardSchemaResolver(phoneFormSchema),
    defaultValues: { phone: '' },
  })

  const [step, setStep] = useState<'initial' | 'email' | 'phone' | 'otp'>('initial')
  const [contact, setContact] = useState('') // Email or phone number
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [resendTimeout, setResendTimeout] = useState(0)

  // Animation variants for transitions
  const variants = {
    enter: { opacity: 0, x: 50 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  }

  // Watch name field from email form
  // const name = emailForm.watch('name')

  // Handle sending OTP to phone number
  const handleSendOtp = async (values: PhoneSignUpFormValues) => {
    setError('')
    phoneForm.clearErrors('phone')
    setIsLoading(true)
    const phoneNumber = values.phone
    setContact(phoneNumber)

    try {
      const { error: err } = await client.phoneNumber.sendOtp({ phoneNumber })

      if (err) {
        setError(err.message!)
        phoneForm.setError('phone', {
          type: 'manual',
          message: err.message ?? 'Failed to send verification code.',
        })
      } else {
        setStep('otp')
        startResendTimeout()
        toastSuccess({
          title: 'Verification Code Sent',
          description: 'Check your phone for the verification code.',
        })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code.')
    } finally {
      setIsLoading(false)
    }
  }

  // Start countdown for resend button
  const startResendTimeout = () => {
    setResendTimeout(60)
    const interval = setInterval(() => {
      setResendTimeout((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  // Handle OTP verification
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { error: err, data } = await client.phoneNumber.verify({
        phoneNumber: contact,
        code: otp,
      })
      console.log('Verification data:', data, err)

      if (err) {
        setError(err.message!)
      } else {
        posthog?.capture('user_signed_up', { method: 'phone' })
        // On successful verification, create account
        router.push('/app/settings')
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed.')
    } finally {
      setIsLoading(false)
    }
  }

  // Handle email registration
  const handleEmailSignup = async (values: EmailSignUpFormValues) => {
    if (turnstileSiteKey && !turnstileToken) {
      setError('Please wait for the security check to complete.')
      return
    }

    setIsLoading(true)
    setError('')

    // Get callbackUrl from URL params (e.g., from invitation flow)
    const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl')

    try {
      const { data: _data, error } = await client.signUp.email({
        email: values.email,
        password: values.password,
        name: '',
        callbackURL: callbackUrl || '/app',
        fetchOptions: {
          headers: turnstileToken ? { 'x-captcha-response': turnstileToken } : {},
        },
      })

      if (error) {
        setError(error.message!)
        resetTurnstile()
        toastError({
          title: 'Registration Failed',
          description: error.message || 'An unexpected error occurred during registration.',
        })
      } else {
        posthog?.capture('user_signed_up', { method: 'email' })
        toastSuccess({
          title: 'Account Created',
          description: 'Verify your email!',
        })
        const loginUrl = new URLSearchParams()
        loginUrl.set('email', values.email)
        // Preserve callbackUrl if present (e.g., from invitation flow)
        const callbackUrl = new URLSearchParams(window.location.search).get('callbackUrl')
        if (callbackUrl) {
          loginUrl.set('callbackUrl', callbackUrl)
        }
        router.push(`/login?${loginUrl.toString()}`)
      }
    } catch (error: any) {
      setError(error.message || 'Registration failed.')
      resetTurnstile()
      toastError({
        title: 'Registration Failed',
        description: error.message || 'An unexpected error occurred during registration.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div className='flex w-full flex-col gap-6'>
        <Card className='shadow-md shadow-black/20 border-transparent'>
          <CardContent className='flex flex-col gap-4 overflow-hidden pt-6'>
            {error && <div className='text-sm font-medium text-destructive'>{error}</div>}

            <AnimatePresence mode='wait'>
              {/* Initial step with multiple sign-up options */}
              {step === 'initial' && (
                <motion.div
                  key='initial'
                  initial='enter'
                  animate='center'
                  exit='exit'
                  variants={variants}
                  transition={{ duration: 0.3 }}>
                  <div className='font-semibold leading-none tracking-tight pb-6 text-xl text-center'>
                    Get started with Auxx.Ai
                  </div>
                  <div className='space-y-4'>
                    <Button variant='outline' className='w-full' onClick={() => setStep('email')}>
                      <Mail />
                      Sign up with Email
                    </Button>
                    <Button variant='outline' className='w-full' onClick={() => setStep('phone')}>
                      <Smartphone />
                      Sign up with Phone
                    </Button>
                  </div>
                  <div className='relative my-4'>
                    <div className='absolute inset-0 flex items-center'>
                      <span className='w-full border-t' />
                    </div>
                    <div className='relative flex justify-center text-xs uppercase'>
                      <span className='bg-background px-2 text-muted-foreground'>Or</span>
                    </div>
                  </div>
                  <div className='space-y-4'>
                    <GeneralSubmitButton
                      icon={<GoogleIcon className='mr-2 size-4' />}
                      width='w-full'
                      variant='outline'
                      text='Login with Google'
                      onClick={() => {
                        posthog?.capture('user_signed_up', { method: 'google' })
                        client.signIn.social({ provider: 'google' })
                      }}
                    />
                    <GeneralSubmitButton
                      icon={<GithubIcon className='mr-2 size-4 text-foreground' />}
                      width='w-full'
                      variant='outline'
                      text='Login with Github'
                      onClick={() => {
                        posthog?.capture('user_signed_up', { method: 'github' })
                        client.signIn.social({ provider: 'github' })
                      }}
                    />
                  </div>
                </motion.div>
              )}

              {/* Email sign-up step */}
              {step === 'email' && (
                <motion.div
                  key='email'
                  initial='enter'
                  animate='center'
                  exit='exit'
                  variants={variants}
                  transition={{ duration: 0.3 }}>
                  <div className='pb-4'>
                    <div className='font-semibold leading-none tracking-tight pb-6 text-xl text-center'>
                      Create your account
                    </div>

                    <Form {...emailForm}>
                      <form
                        onSubmit={emailForm.handleSubmit(handleEmailSignup)}
                        className='w-full space-y-4'>
                        <FormField
                          control={emailForm.control}
                          name='email'
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  type='email'
                                  placeholder='your@email.com'
                                  autoFocus
                                  {...field}
                                  disabled={isLoading}
                                  onChange={(e) => {
                                    field.onChange(e)
                                    setContact(e.target.value)
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={emailForm.control}
                          name='password'
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <PasswordField
                                  password={password}
                                  setPassword={(val) => {
                                    setPassword(val)
                                    field.onChange(val)
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button
                          type='submit'
                          className='w-full'
                          loading={isLoading}
                          disabled={!!turnstileSiteKey && !turnstileToken}
                          loadingText='Creating Account...'>
                          Create Account
                        </Button>
                      </form>
                    </Form>
                  </div>
                  <div className='text-right flex items-center mt-4'>
                    <Button
                      variant='link'
                      className='h-auto p-0 font-normal'
                      onClick={() => setStep('initial')}>
                      Back
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Phone sign-up step */}
              {step === 'phone' && (
                <motion.div
                  key='phone'
                  initial='enter'
                  animate='center'
                  exit='exit'
                  variants={variants}
                  transition={{ duration: 0.3 }}>
                  <div className='space-y-4'>
                    <div className='font-semibold leading-none tracking-tight text-xl text-center'>
                      Enter your details
                    </div>

                    <p className='text-sm text-muted-foreground'>
                      We will send a verification code to your phone number.
                    </p>

                    <Form {...phoneForm}>
                      <form
                        onSubmit={phoneForm.handleSubmit(handleSendOtp)}
                        className='w-full space-y-4'>
                        <FormField
                          control={phoneForm.control}
                          name='phone'
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone Number</FormLabel>
                              <FormControl>
                                <PhoneInputWithFlag
                                  value={field.value}
                                  onChange={field.onChange}
                                  onBlur={field.onBlur}
                                  name={field.name}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <Button
                          type='submit'
                          className='w-full'
                          loading={isLoading}
                          loadingText='Sending code...'>
                          Send Code
                        </Button>
                      </form>
                    </Form>
                  </div>

                  <div className='text-right flex items-center mt-4'>
                    <Button
                      variant='link'
                      className='h-auto p-0 font-normal'
                      onClick={() => setStep('initial')}>
                      Back
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* OTP verification step */}
              {step === 'otp' && (
                <motion.div
                  key='otp'
                  initial='enter'
                  animate='center'
                  exit='exit'
                  variants={variants}
                  transition={{ duration: 0.3 }}>
                  <div className='space-y-4'>
                    <div className='font-semibold leading-none tracking-tight pt-6 text-xl text-center'>
                      Check your text messages
                    </div>

                    <p className='text-sm text-muted-foreground'>
                      We sent a verification code to {contact}. Please enter it below.
                    </p>

                    <form onSubmit={handleVerifyOtp}>
                      <div className='flex items-center justify-center'>
                        <InputOTP
                          maxLength={6}
                          value={otp}
                          onChange={(value) => setOtp(value)}
                          autoFocus>
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>

                      <Button
                        type='submit'
                        className='w-full mt-4'
                        disabled={isLoading || otp.length < 6}
                        loading={isLoading}
                        loadingText='Verifying...'>
                        Verify Code
                      </Button>
                    </form>

                    <div className=''>
                      <p className='text-sm text-muted-foreground'>
                        Didn&apos;t receive the code?{' '}
                        <Button
                          variant='link'
                          className='h-auto p-0 font-normal'
                          disabled={resendTimeout > 0 || isLoading}
                          onClick={async () => {
                            setIsLoading(true)
                            try {
                              const { error } = await client.phoneNumber.sendOtp({
                                phoneNumber: contact,
                              })

                              if (error) {
                                setError(error.message!)
                              } else {
                                startResendTimeout()
                                toastSuccess({
                                  title: 'Code Resent',
                                  description: 'A new verification code has been sent.',
                                })
                              }
                            } catch (err: any) {
                              setError(err.message || 'Failed to resend code.')
                            } finally {
                              setIsLoading(false)
                            }
                          }}>
                          Resend
                        </Button>
                      </p>
                      {resendTimeout > 0 && (
                        <p className='text-sm text-muted-foreground'>
                          New code will be available in {resendTimeout} seconds.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className='text-right flex items-center mt-4'>
                    <Button
                      variant='link'
                      className='h-auto p-0 font-normal'
                      onClick={() => setStep('phone')}>
                      Back
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
      <p className='text-center text-sm text-muted-foreground'>
        Already have an account?{' '}
        <Button variant='link' className='h-auto p-0' asChild>
          <Link href='/login'>Log in</Link>
        </Button>
      </p>
      {turnstileSiteKey && (
        <div className='min-h-[75px]'>
          <Turnstile
            ref={turnstileRef}
            siteKey={turnstileSiteKey}
            onSuccess={onTurnstileSuccess}
            onExpire={onTurnstileExpire}
            onError={onTurnstileError}
            options={{ size: 'invisible' }}
          />
        </div>
      )}
    </>
  )
}
