// src/app/(auth)/login/page.tsx

import { isTrustedHostname, WEBAPP_URL } from '@auxx/config/server'
import { issueLoginToken } from '@auxx/credentials/login-token'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react' // Import Suspense
import { auth } from '~/auth/server'
import { getTrustedAppOrigin } from '~/auth/trusted-apps'
import { Logo } from '~/components/global/login/logo'
import LoginForm from '../_components/login-form'

// LoginContentProps captures the query params forwarded to the login form.
interface LoginContentProps {
  searchParams?: { [key: string]: string | string[] | undefined }
}
// LoginPageProps reflects the Next.js search params contract for this page.
interface LoginPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}

// resolveRedirectTarget detangles callbackUrl safely for subsequent navigations
const resolveRedirectTarget = (value: string | string[] | undefined): string => {
  const defaultRedirect = '/app'
  if (!value) return defaultRedirect
  const candidate = Array.isArray(value) ? value[0] : value

  // Allow relative paths
  if (candidate!.startsWith('/') && !candidate!.startsWith('//') && !candidate!.includes('..')) {
    return candidate
  }

  // Allow external URLs to trusted domains (for cross-app redirects like developer portal)
  if (candidate!.startsWith('http://') || candidate!.startsWith('https://')) {
    try {
      const url = new URL(candidate)
      if (isTrustedHostname(url.hostname)) {
        return candidate
      }
    } catch (_e) {
      // Invalid URL, fall through to warning
    }
  }

  console.warn(
    `LoginPage: Ignored invalid callbackUrl "${candidate}". Falling back to ${defaultRedirect}.`
  )
  return defaultRedirect
}

// Use a separate component to read searchParams to allow LoginForm to be static or RSC
// This avoids making the whole page dynamic just for searchParams
// LoginPageContent renders the login form once query params are resolved.
async function LoginPageContent({ searchParams }: LoginContentProps) {
  const callbackUrl = searchParams?.callbackUrl
  const callbackApp = searchParams?.callbackApp as string | undefined
  const returnTo = searchParams?.returnTo as string | undefined
  const error = searchParams?.error as string | undefined // Get error from URL

  return (
    <LoginForm
      callbackUrl={callbackUrl}
      callbackApp={callbackApp}
      returnTo={returnTo}
      errorMsg={error}
    />
  )
}

// Login guards the login route, redirecting authenticated users server-side.
async function Login({ searchParams }: LoginPageProps) {
  const q = await searchParams
  const redirectTarget = resolveRedirectTarget(q?.callbackUrl)
  const session = await auth.api.getSession({ headers: await headers() })

  if (session?.user) {
    // Cross-app flow: user is already logged in, issue token and redirect to satellite
    const callbackApp = q?.callbackApp as string | undefined
    if (callbackApp) {
      const returnTo = (q?.returnTo as string) || '/'
      const safePath =
        typeof returnTo === 'string' &&
        returnTo.startsWith('/') &&
        !returnTo.startsWith('//') &&
        !returnTo.includes('..')
          ? returnTo
          : '/'

      // KB needs the kbId to resolve a (possibly custom-domain) origin —
      // delegate to /kb-auth which knows how to look it up.
      if (callbackApp === 'kb') {
        const kbId = (q?.kbId as string) || ''
        const params = new URLSearchParams({ kbId, returnTo: safePath })
        redirect(`/kb-auth?${params.toString()}`)
      }

      const targetOrigin = getTrustedAppOrigin(callbackApp)
      if (targetOrigin) {
        const result = await issueLoginToken({
          userId: session.user.id,
          email: session.user.email,
          targetOrigin,
          issuerOrigin: WEBAPP_URL,
          returnTo: safePath,
        })
        if (result.isOk()) {
          redirect(`${targetOrigin}/auth/verify?loginToken=${result.value.token}`)
        }
      }
    }

    // Check if this is an OAuth flow (client_id parameter indicates OAuth)
    if (q?.client_id) {
      // For OAuth flows with an already-authenticated user, redirect back to authorize
      // This allows better-auth to complete the OAuth flow immediately
      const oauthParams = new URLSearchParams()
      for (const [key, value] of Object.entries(q)) {
        if (value) {
          const paramValue = Array.isArray(value) ? value[0] : value
          if (paramValue) {
            oauthParams.set(key, paramValue)
          }
        }
      }
      redirect(`/api/auth/oauth2/authorize?${oauthParams.toString()}`)
    }

    redirect(redirectTarget)
  }

  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10  '>
      <div className='flex w-full max-w-sm flex-col items-center gap-4'>
        <Logo />
        <Suspense fallback={<div>Loading...</div>}>
          <LoginPageContent searchParams={q} />
        </Suspense>
      </div>
    </div>
  )
}

export default Login
