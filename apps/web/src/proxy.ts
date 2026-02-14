// export const middleware = () => {};

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// import NextAuth from 'next-auth'
// import { auth } from './server/auth'

// import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// const isPublicRoute = createRouteMatcher([
// const publicPaths = [
//   '/',
//   '/login(.*)',
//   '/sign-up(.*)',
//   '/api/webhooks(.*)',
//   '/api/initial-sync(.*)',
//   '/api/email-analysis(.*',
//   '/api/aurinko/webhook(.*)',
//   '/api/stripe(.*)',
//   '/privacy',
//   '/terms-of-service',
// ]

// const noOnboardingPaths = [...publicPaths, '/onboarding']

// export default clerkMiddleware((auth, req) => {
//   if (!isPublicRoute(req)) {
//     auth().protect();
//   }
// });

export async function proxy(req: NextRequest) {
  // console.log('route', req.nextUrl.pathname)
  // const session = await auth()

  const { pathname } = req.nextUrl
  // const isPublicPath = publicPaths.some(
  //   (path) => pathname === path || pathname.startsWith(`${path}/`)
  // )
  if (req.nextUrl.pathname.startsWith('/setup')) {
    return NextResponse.next()
  }

  /*
  const sessionToken =
    req.cookies.get('__Secure-next-auth.session-token') ||
    req.cookies.get('next-auth.session-token') ||
    req.cookies.get('authjs.session-token')

  if (!sessionToken && !isPublicPath) {
    // No session token found, redirect to login
    const signInUrl = new URL('/login', req.url)
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname)
    return NextResponse.redirect(signInUrl)
  }
  */
  // Token exists, proceed
  // return NextResponse.next()

  // console.log(req)
  /*
  if (!session && !isPublicPath) {
    const url = new URL('/api/auth/signin', req.url)
    url.searchParams.set('callbackUrl', encodeURI(req.url))
    return NextResponse.redirect(url)
  }
  // If logged in but hasn't completed onboarding, redirect to onboarding
  if (
    session &&
    !session.user.completedOnboarding &&
    !noOnboardingPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    )
  ) { 
    return NextResponse.redirect(new URL('/onboarding', req.url))
  }*/
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
