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
import { useRouter, useSearchParams } from 'next/navigation'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { client } from '~/auth/auth-client'
import { PasswordField } from '~/components/credentials/password-fields'
import { GithubIcon, GoogleIcon } from '~/constants/icons'
import { useAnalytics } from '~/hooks/use-analytics'
import { useTurnstile } from '~/hooks/use-turnstile'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
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
  const { homepageUrl, turnstileSiteKey } = useEnv()
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

  // An invite link carries its token here (`/signup?invitationToken=...`). When
  // it resolves, the account being created is bound to the invited address:
  // prefilled, locked, and re-checked server-side on submit.
  const searchParams = useSearchParams()
  const invitationToken = searchParams.get('invitationToken')
  const { data: invitation } = api.member.invitationPreview.useQuery(
    { token: invitationToken ?? '' },
    { enabled: !!invitationToken, staleTime: 5 * 60 * 1000, retry: false }
  )
  const invitedEmail = invitation?.valid ? invitation.email : null

  const [step, setStep] = useState<'initial' | 'email' | 'phone' | 'otp'>('initial')
  const [contact, setContact] = useState('') // Email or phone number
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [resendTimeout, setResendTimeout] = useState(0)
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined)
  const contentRef = useRef<HTMLDivElement>(null)

  // Once the invitation resolves, jump straight to the email step with the
  // invited address in place — phone signup is skipped entirely, since an
  // account created without an email can never satisfy an email-bound invite.
  useEffect(() => {
    if (!invitedEmail) return
    emailForm.setValue('email', invitedEmail)
    setContact(invitedEmail)
    setStep((current) => (current === 'initial' ? 'email' : current))
  }, [invitedEmail, emailForm])

  useEffect(() => {
    if (!contentRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
        setContentHeight(height)
      }
    })
    observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [])

  // Animation variants for transitions
  const variants = {
    enter: { opacity: 0 },
    center: { opacity: 1 },
    exit: { opacity: 0 },
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
    const searchParams = new URLSearchParams(window.location.search)
    const callbackUrl = searchParams.get('callbackUrl')
    // Tag signups so the organization seeder can branch on origin:
    //  - 'shopify-claim' → skip the auto Stripe trial (Shopify Billing owns it, App Store rule 1.2.1)
    //  - 'startup' → land on the Growth plan with the startup discount (marketing /startups?ref=startup)
    const signupSource = callbackUrl?.startsWith('/shopify/claim')
      ? 'shopify-claim'
      : searchParams.get('ref') === 'startup'
        ? 'startup'
        : 'web'

    try {
      const { data: _data, error } = await client.signUp.email({
        // The invited address wins over anything in the field — the server
        // rejects a mismatch, so sending the invited value keeps a stale form
        // state from producing a confusing error instead of a signup.
        email: invitedEmail ?? values.email,
        password: values.password,
        name: '',
        // Land an invited signup back on the invitation so it completes, rather
        // than on an empty /app they have no organization for yet.
        callbackURL:
          callbackUrl || (invitationToken ? `/accept-invitation?token=${invitationToken}` : '/app'),
        signupSource,
        // Not persisted on the user — read by the auth before-hook to bind this
        // account to the invitation. See auth/server.ts.
        ...(invitationToken ? { invitationToken } : {}),
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
        <Card variant='translucent' className='border-transparent px-4 py-6'>
          <CardContent className='flex flex-col gap-4 overflow-hidden '>
            {error && <div className='text-sm font-medium text-destructive'>{error}</div>}

            {/* A dead invite link must say so. Falling through to a plain signup
                looks like it worked, and lands them in their own new org. */}
            {invitation && !invitation.valid && (
              <div className='text-sm text-destructive'>
                {invitation.reason === 'expired'
                  ? 'This invitation has expired.'
                  : invitation.reason === 'used'
                    ? 'This invitation has already been used.'
                    : 'This invitation link is not valid.'}{' '}
                Ask an admin to send you a new one.
              </div>
            )}

            <motion.div
              animate={{ height: contentHeight }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}>
              <div ref={contentRef} className='p-1'>
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
                        <Button
                          variant='translucent'
                          className='w-full'
                          onClick={() => setStep('email')}>
                          <Mail />
                          Sign up with Email
                        </Button>
                        <Button
                          variant='translucent'
                          className='w-full'
                          onClick={() => setStep('phone')}>
                          <Smartphone />
                          Sign up with Phone
                        </Button>
                      </div>
                      <div className='relative my-6'>
                        <div className='absolute inset-0 flex items-center'>
                          <span className='w-full border-t border-white/20' />
                        </div>
                        <div className='relative flex justify-center text-xs uppercase'>
                          <span className='bg-translucent px-2 py-1 rounded-full text-white/90'>
                            Or
                          </span>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <GeneralSubmitButton
                          icon={<GoogleIcon className='mr-2 size-4' />}
                          width='w-full'
                          variant='translucent'
                          text='Login with Google'
                          onClick={() => {
                            posthog?.capture('user_signed_up', { method: 'google' })
                            const callbackUrl =
                              new URLSearchParams(window.location.search).get('callbackUrl') ||
                              '/app'
                            client.signIn.social({ provider: 'google', callbackURL: callbackUrl })
                          }}
                        />
                        <GeneralSubmitButton
                          icon={<GithubIcon className='mr-2 size-4 text-black' />}
                          width='w-full'
                          variant='translucent'
                          text='Login with Github'
                          onClick={() => {
                            posthog?.capture('user_signed_up', { method: 'github' })
                            const callbackUrl =
                              new URLSearchParams(window.location.search).get('callbackUrl') ||
                              '/app'
                            client.signIn.social({ provider: 'github', callbackURL: callbackUrl })
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
                        <div className='font-semibold leading-none tracking-tight pb-2 text-xl text-center'>
                          Create your account
                        </div>
                        {invitedEmail ? (
                          <p className='pb-6 text-center text-sm text-white/60'>
                            You've been invited to join{' '}
                            <span className='text-white'>
                              {(invitation?.valid && invitation.organizationName) || 'a team'}
                            </span>{' '}
                            as <span className='text-white'>{invitedEmail}</span>. Your account must
                            use this address.
                          </p>
                        ) : (
                          <div className='pb-4' />
                        )}

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
                                      variant='translucent'
                                      size='lg'
                                      type='email'
                                      placeholder='your@email.com'
                                      autoFocus={!invitedEmail}
                                      {...field}
                                      readOnly={!!invitedEmail}
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
                                      variant='translucent'
                                      size='lg'
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
                              variant='translucent'
                              className='w-full'
                              loading={isLoading}
                              disabled={!!turnstileSiteKey && !turnstileToken}
                              loadingText='Creating Account...'>
                              Create Account
                            </Button>
                          </form>
                        </Form>
                      </div>
                      <p className='text-xs text-white/60 pt-3 leading-snug'>
                        By clicking 'Create Account', you agree to our{' '}
                        <Link
                          href={`${homepageUrl}/terms-of-service`}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='text-white underline underline-offset-5 hover:text-white/80'>
                          terms
                        </Link>{' '}
                        and{' '}
                        <Link
                          href={`${homepageUrl}/privacy-policy`}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='text-white underline underline-offset-5 hover:text-white/80'>
                          privacy policy
                        </Link>
                        .
                      </p>

                      {/* An invited signup has nowhere to go back TO — the other
                          methods can't be bound to the invited address. */}
                      {!invitedEmail && (
                        <div className='text-right flex items-center mt-4'>
                          <Button
                            variant='link'
                            className='h-auto p-0 font-normal text-white'
                            onClick={() => setStep('initial')}>
                            Back
                          </Button>
                        </div>
                      )}
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

                        <p className='text-sm text-white/60'>
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
                              variant='translucent'
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
                          className='h-auto p-0 font-normal text-white/60'
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
                            variant='translucent'
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
              </div>
            </motion.div>
          </CardContent>
        </Card>
      </div>
      <p className='text-center text-sm text-white/60'>
        Already have an account?{' '}
        <Button variant='link' className='h-auto p-0 text-white' asChild>
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
            options={{ size: 'flexible' }}
          />
        </div>
      )}
    </>
  )
}
