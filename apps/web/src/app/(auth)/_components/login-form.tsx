// src/app/(auth)/login/_components/login-form.tsx
'use client'
// import { getCsrfToken } from 'next-auth/react' // Needed if CSRF protection is strict
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter, // Import CardFooter if needed for links
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@auxx/ui/components/input-otp'
import { toastSuccess } from '@auxx/ui/components/toast'
import { Lock } from 'lucide-react'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link' // For Sign Up link
import { useRouter, useSearchParams } from 'next/navigation'
import type React from 'react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { client } from '~/auth/auth-client' // Use the cached auth
import { PasswordInput } from '~/components/credentials/password-fields'
import { GithubIcon, GoogleIcon } from '~/constants/icons'
import { useAnalytics } from '~/hooks/use-analytics'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { GeneralSubmitButton } from './submit-button'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
})
type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginForm({
  callbackUrl,
  errorMsg: _errorMsg, // Pass error from page searchParams
}: {
  callbackUrl?: string | string[] // Can be array if multiple values passed
  errorMsg?: string
}) {
  const router = useRouter()
  const posthog = useAnalytics()
  const { homepageUrl } = useEnv()
  const variants = {
    enter: { opacity: 0, x: 50 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  }

  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<'initial' | 'otp' | 'password'>('initial')
  const [contact, setContact] = useState('') // email or phone
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [resendTimeout, setResendTimeout] = useState(0)
  const searchParams = useSearchParams()

  const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s)
  const isPhone = (s: string) => /^\+?\d{7,15}$/.test(s)

  const [_lastProvider, setLastProvider] = useState<string | null>(null)
  useEffect(() => {
    setLastProvider(localStorage.getItem('lastProvider'))
  }, [])

  // Enable passkey autofill for seamless authentication
  const enablePasskeyAutofill = async () => {
    try {
      const processedUrl = processCallbackUrl(callbackUrl)
      let redirectTo = '/app'
      let isExternal = false

      if (typeof processedUrl === 'string') {
        if (
          processedUrl.startsWith('/') &&
          !processedUrl.startsWith('//') &&
          !processedUrl.includes('..')
        ) {
          redirectTo = processedUrl
        } else if (processedUrl.startsWith('http://') || processedUrl.startsWith('https://')) {
          try {
            const url = new URL(processedUrl)
            const trustedDomains = ['localhost', 'auxx.ai']
            const isTrusted = trustedDomains.some(
              (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
            )
            if (isTrusted) {
              redirectTo = processedUrl
              isExternal = true
            }
          } catch (e) {
            // Use default
          }
        }
      }

      await client.signIn.passkey({
        autoFill: true,
        fetchOptions: {
          onSuccess: () => {
            posthog?.capture('user_logged_in', { method: 'passkey' })
            if (isExternal) {
              window.location.href = redirectTo
            } else {
              router.push(redirectTo)
            }
          },
        },
      })
    } catch (error) {
      // Silently handle autofill errors - user can still sign in manually
      console.debug('Passkey autofill failed:', error)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: enablePasskeyAutofill is stable and callbackUrl/router are not captured
  useEffect(() => {
    // Check if passkey conditional UI is available
    if (
      !PublicKeyCredential?.isConditionalMediationAvailable ||
      !PublicKeyCredential.isConditionalMediationAvailable()
    ) {
      return
    }

    enablePasskeyAutofill()
  }, [])

  // Auto-fill email from URL parameter (e.g., from signup redirect)
  // biome-ignore lint/correctness/useExhaustiveDependencies: isEmail is a stable local function
  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam && isEmail(emailParam)) {
      setContact(emailParam)
      setStep('password')
    }
  }, [searchParams])

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!contact.trim()) {
      setError('Please enter your email or phone.')
      return
    }

    if (isPhone(contact)) {
      // Phone flow → send OTP
      const { error: err } = await client.phoneNumber.sendOtp({
        phoneNumber: contact,
        // callbackURL: '/app/settings',
      })
      if (err) return setError(err.message!)
      setStep('otp')
      startResendTimeout()
    } else if (isEmail(contact)) {
      // Email flow → show password input
      setStep('password')
    } else {
      setError('Please enter a valid email or phone (+1234567890).')
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const { error: err } = await client.phoneNumber.verify({
      phoneNumber: contact,
      code: otp,
      // callbackURL: '/app/settings',
    })
    if (err) setError(err.message!)
    else posthog?.capture('user_logged_in', { method: 'phone' })
    // on success Better Auth will redirect
  }

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const { error: err } = await client.signIn.email({
      email: contact,
      password,
      callbackURL: redirectToPath,
    })

    if (err) {
      setError(err.message!)
      setIsLoading(false)
      return
    }

    posthog?.capture('user_logged_in', { method: 'email' })

    // For external callbacks, manually redirect
    if (isExternalCallback) {
      window.location.href = redirectToPath
    } else {
      router.push(redirectToPath)
    }

    setIsLoading(false)
  }

  // Standardize callbackUrl handling
  const processCallbackUrl = (url: string | string[] | undefined): string | undefined => {
    if (Array.isArray(url)) {
      return url[0] // Take the first value if it's an array
    }
    return url
  }

  const handleSSO = async () => {
    console.log('SSO clicked')
  }

  const initialCallbackUrl = processCallbackUrl(callbackUrl)

  // Check if this is an OAuth flow (client_id parameter indicates OAuth)
  const isOAuthFlow = searchParams.get('client_id') !== null

  // Determine the redirect target for the signIn action
  const defaultRedirectPath = '/app'
  let redirectToPath = defaultRedirectPath
  let isExternalCallback = false

  if (isOAuthFlow) {
    // For OAuth flows, DO NOT redirect back to authorize endpoint
    // Better-auth's OIDC provider stores the authorization request internally
    // and will complete it automatically after successful login
    // Just redirect to the default app page - better-auth will intercept and complete OAuth
    redirectToPath = defaultRedirectPath
  } else if (typeof initialCallbackUrl === 'string') {
    // Check if it's a relative path (internal redirect)
    if (
      initialCallbackUrl.startsWith('/') &&
      !initialCallbackUrl.startsWith('//') &&
      !initialCallbackUrl.includes('..')
    ) {
      redirectToPath = initialCallbackUrl
    }
    // Check if it's an external URL (for cross-app redirects like developer portal)
    else if (
      initialCallbackUrl.startsWith('http://') ||
      initialCallbackUrl.startsWith('https://')
    ) {
      // Allow redirects to trusted domains only
      try {
        const url = new URL(initialCallbackUrl)
        const trustedDomains = ['localhost', 'auxx.ai']
        const isTrusted = trustedDomains.some(
          (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
        )
        if (isTrusted) {
          redirectToPath = initialCallbackUrl
          isExternalCallback = true
        } else {
          console.warn(`LoginForm: Untrusted callbackUrl "${initialCallbackUrl}". Using default.`)
        }
      } catch (e) {
        console.warn(`LoginForm: Invalid URL "${initialCallbackUrl}". Using default.`)
      }
    } else {
      console.warn(`LoginForm: Invalid callbackUrl "${initialCallbackUrl}". Using default.`)
    }
  }

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

  return (
    <div className='flex w-full flex-col gap-6'>
      <Card className='shadow-md shadow-black/20 border-transparent'>
        <CardHeader className='text-center'>
          <CardTitle className='text-xl'>Welcome Back</CardTitle>
          <CardDescription className='sr-only'>Sign in to your AuxxLift account</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <AnimatePresence mode='wait'>
            {/* Display Login Errors */}
            {/* Email/Password Form */}
            {/* <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4"> */}

            {step === 'initial' && (
              <motion.form
                key='initial'
                onSubmit={handleContinue}
                initial='enter'
                animate='center'
                exit='exit'
                variants={variants}
                transition={{ duration: 0.3 }}>
                <div className='space-y-2'>
                  <Input
                    placeholder='Email or phone'
                    value={contact}
                    autoComplete='username webauthn'
                    onChange={(e) => setContact(e.target.value.trim())}
                  />
                  {error && (
                    <p
                      className='peer-aria-invalid:text-red-500 mt-2 text-xs text-red-500'
                      role='alert'
                      aria-live='polite'>
                      {error}
                    </p>
                  )}
                  <Button
                    type='submit'
                    variant='outline'
                    className='w-full'
                    loading={isLoading}
                    loadingText='Logging in...'>
                    Continue with Email or Phone
                  </Button>
                </div>
                {/* Divider */}
                <div className='relative my-4'>
                  <div className='absolute inset-0 flex items-center'>
                    <span className='w-full border-t' />
                  </div>
                  <div className='relative flex justify-center text-xs uppercase'>
                    <span className='bg-background px-2 text-muted-foreground'>
                      Or continue with
                    </span>
                  </div>
                </div>

                {/* OAuth Buttons */}
                <div className='flex flex-col gap-3'>
                  <GeneralSubmitButton
                    icon={<GoogleIcon className='mr-2 size-4' />} // Add margin if needed
                    width='w-full'
                    variant='outline'
                    text='Login with Google'
                    onClick={() => {
                      posthog?.capture('user_logged_in', { method: 'google' })
                      setIsLoading(true)
                      client.signIn.social({ provider: 'google', callbackURL: redirectToPath })
                    }}
                  />
                  <GeneralSubmitButton
                    icon={<GithubIcon className='mr-2 size-4 text-foreground' />} // Add margin if needed
                    width='w-full'
                    variant='outline'
                    text='Login with Github'
                    onClick={() => {
                      posthog?.capture('user_logged_in', { method: 'github' })
                      setIsLoading(true)
                      client.signIn.social({ provider: 'github', callbackURL: redirectToPath })
                    }}
                  />
                  <Button
                    type='button'
                    className='w-full'
                    variant='outline'
                    onClick={() => handleSSO()}>
                    <Lock className='size-4' />
                    Continue with SSO
                  </Button>
                </div>

                {/* <button type="submit" style={{ width: '100%', padding: 10 }}>
                  Continue
                </button> */}
              </motion.form>
            )}

            {step === 'otp' && (
              <motion.form
                key='otp'
                onSubmit={handleVerifyOtp}
                initial='enter'
                animate='center'
                exit='exit'
                variants={variants}
                transition={{ duration: 0.3 }}>
                <div className='space-y-4'>
                  <p>Enter the code we sent to {contact}</p>
                  {error && <p style={{ color: 'red' }}>{error}</p>}
                  <div className='flex items-center justify-center'>
                    <InputOTP maxLength={6} value={otp} onChange={(value) => setOtp(value)}>
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
                    loadingText='Verifying...'>
                    Verify Code
                  </Button>
                  <div className=''>
                    <div className='text-sm text-muted-foreground'>
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
                    </div>
                    {resendTimeout > 0 && (
                      <p className='text-sm text-muted-foreground'>
                        New code will be available in {resendTimeout} seconds.
                      </p>
                    )}
                  </div>
                </div>
                <div className='text-right flex items-center justify-between mt-4'>
                  <Button
                    variant='link'
                    size='sm'
                    className='h-auto p-0 font-normal'
                    onClick={() => setStep('initial')}>
                    Back
                  </Button>
                </div>
              </motion.form>
            )}

            {step === 'password' && (
              <motion.form
                key='password'
                onSubmit={handleEmailSignIn}
                initial='enter'
                animate='center'
                exit='exit'
                variants={variants}
                transition={{ duration: 0.3 }}>
                <div className='space-y-4'>
                  <div className='text-sm'>
                    Sign in as{' '}
                    <Badge variant='pill' size='sm'>
                      {contact}
                    </Badge>
                  </div>
                  {error && <p className='text-xs text-red-500'>{error}</p>}
                  <PasswordInput
                    placeholder='Your password'
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete='current-password webauthn'
                    value={password}
                    required
                  />
                  {/* <Input
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password webauthn"
                    required
                  /> */}
                  <Button
                    type='submit'
                    className='w-full'
                    loading={isLoading}
                    loadingText='Signing in...'>
                    Sign in
                  </Button>
                </div>
                <div className='text-right flex items-center justify-between mt-4'>
                  <Button
                    variant='link'
                    size='sm'
                    className='h-auto p-0 font-normal'
                    onClick={() => setStep('initial')}>
                    Back
                  </Button>

                  <Button variant='link' size='sm' className='h-auto p-0 font-normal' asChild>
                    <Link href='/forgot-password'>Forgot password?</Link>
                  </Button>
                </div>
              </motion.form>
            )}

            {/* Consider adding a "Forgot Password?" link */}

            {/* </form> */}
          </AnimatePresence>
        </CardContent>
        <CardFooter className='flex flex-col items-center gap-2 text-center text-xs text-muted-foreground'>
          <div className='flex flex-row items-center gap-2'>
            <span>
              Don&apos;t have an account?{' '}
              <Button variant='link' className='h-auto p-0' asChild>
                <Link
                  href={
                    redirectToPath !== defaultRedirectPath
                      ? `/signup?callbackUrl=${encodeURIComponent(redirectToPath)}`
                      : '/signup'
                  }>
                  Sign up
                </Link>
              </Button>
            </span>
            {step !== 'password' && (
              <>
                |
                <span>
                  <Button variant='link' className='h-auto p-0' asChild>
                    <Link href='/forgot-password'>Forgot password?</Link>
                  </Button>
                </span>
              </>
            )}
          </div>
          <span className=''>
            By clicking continue, you agree to our{' '}
            <Button variant='link' className='h-auto p-0 text-xs' asChild>
              <Link
                href={`${homepageUrl}/terms-of-service`}
                target='_blank'
                rel='noopener noreferrer'>
                terms and service
              </Link>
            </Button>{' '}
            and{' '}
            <Button variant='link' className='h-auto p-0 text-xs' asChild>
              <Link
                href={`${homepageUrl}/privacy-policy`}
                target='_blank'
                rel='noopener noreferrer'>
                privacy policy
              </Link>
            </Button>
            .
          </span>
        </CardFooter>
      </Card>
    </div>
  )
}
